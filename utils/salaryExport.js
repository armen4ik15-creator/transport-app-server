const ExcelJS = require('exceljs');
const {
  asNumber,
  calcDriverDeductions,
  calcDriverTripAccrued,
  formatPeriodLabel,
  formatRuDate,
  monthBoundsFromIso,
  monthKeyFromIso,
  monthLabelFromIso,
  parseIsoDate,
  resolvePaymentPeriod,
  toIsoDate,
} = require('./salaryCalculations');

const SALARY_HEADERS = [
  'Сотрудник',
  'Должность',
  'Период',
  'Дата выплаты',
  'Начало периода',
  'Конец периода',
  'Начислено, ₽',
  'Выплачено (нал), ₽',
  'Выплачено (безнал), ₽',
  'Итого выплата, ₽',
  'Долг/переплата, ₽',
  'Комментарий',
];

const PAYOUT_TYPES = new Set(['salary', 'advance', 'bonus']);

function addHeaderRow(sheet, headers) {
  sheet.addRow(headers);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8EEF7' },
  };
}

function styleMoneyCells(row, indexes) {
  indexes.forEach((index) => {
    const cell = row.getCell(index);
    cell.numFmt = '#,##0.00';
    cell.alignment = { horizontal: 'right' };
  });
}

function addMonthTitleRow(sheet, label) {
  const row = sheet.addRow([label]);
  row.font = { bold: true, size: 12 };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFDCE6F7' },
  };
  sheet.mergeCells(row.number, 1, row.number, SALARY_HEADERS.length);
}

function addTotalsRow(sheet, totals) {
  const row = sheet.addRow([
    'ИТОГО за месяц',
    '',
    '',
    '',
    '',
    '',
    totals.accrued,
    totals.cash,
    totals.noncash,
    totals.paid,
    totals.debt,
    '',
  ]);
  row.font = { bold: true };
  styleMoneyCells(row, [7, 8, 9, 10, 11]);
}

function buildPaymentComment(payment) {
  const parts = [];
  if (payment.type === 'advance') parts.push('Аванс');
  if (payment.type === 'bonus') parts.push('Премия');
  if (payment.type === 'deduction') parts.push('Удержание');
  if (payment.note) parts.push(String(payment.note));
  return parts.join(' · ');
}

function paymentSortKey(payment) {
  const period = resolvePaymentPeriod(payment);
  return period?.start ?? String(payment.created_at ?? '').slice(0, 10);
}

function fetchPayments(db, { dateFrom, dateTo, driverId }) {
  const where = [];
  const params = [];

  if (driverId) {
    where.push('p.driver_id = ?');
    params.push(driverId);
  }

  if (dateFrom) {
    where.push('date(COALESCE(p.period_end, p.created_at)) >= date(?)');
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push('date(COALESCE(p.period_start, p.created_at)) <= date(?)');
    params.push(dateTo);
  }

  return db
    .prepare(
      `SELECT
         p.id,
         p.driver_id,
         p.type,
         p.amount,
         p.method,
         p.note,
         p.period_start,
         p.period_end,
         p.created_at,
         u.full_name AS driver_name
       FROM driver_payments p
       JOIN drivers d ON d.id = p.driver_id
       JOIN users u ON u.id = d.user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY COALESCE(p.period_start, p.created_at) ASC, p.id ASC`
    )
    .all(...params);
}

function fetchDriversWithTripsInMonth(db, monthStart, monthEnd, driverId) {
  const where = [
    "(t.status = 'completed' OR (t.status IS NULL AND t.stage = 'unloading'))",
    'date(COALESCE(t.completed_at, t.created_at)) >= date(?)',
    'date(COALESCE(t.completed_at, t.created_at)) <= date(?)',
  ];
  const params = [monthStart, monthEnd];

  if (driverId) {
    where.push('t.driver_id = ?');
    params.push(driverId);
  }

  return db
    .prepare(
      `SELECT DISTINCT t.driver_id, u.full_name AS driver_name
       FROM trips t
       JOIN drivers d ON d.id = t.driver_id
       JOIN users u ON u.id = d.user_id
       WHERE ${where.join(' AND ')}
       ORDER BY u.full_name ASC`
    )
    .all(...params);
}

function listMonthsInRange(dateFrom, dateTo) {
  const start = parseIsoDate(dateFrom);
  const end = parseIsoDate(dateTo);
  if (!start || !end || start > end) return [];

  const keys = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cursor <= last) {
    keys.push(monthKeyFromIso(toIsoDate(cursor)));
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return keys;
}

function buildSalaryTimesheetWorkbook(db, { dateFrom, dateTo, driverId }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Зарплатный табель');
  addHeaderRow(sheet, SALARY_HEADERS);

  const payments = fetchPayments(db, { dateFrom, dateTo, driverId });
  const paymentsByMonth = new Map();

  payments.forEach((payment) => {
    const period = resolvePaymentPeriod(payment);
    const monthKey = monthKeyFromIso(period?.end ?? payment.created_at);
    if (!monthKey) return;
    if (!paymentsByMonth.has(monthKey)) paymentsByMonth.set(monthKey, []);
    paymentsByMonth.get(monthKey).push(payment);
  });

  if (dateFrom) {
    const fromKey = monthKeyFromIso(dateFrom);
    if (fromKey && !paymentsByMonth.has(fromKey)) paymentsByMonth.set(fromKey, []);
  }

  const monthKeysFromRange = listMonthsInRange(dateFrom, dateTo);
  monthKeysFromRange.forEach((key) => {
    if (!paymentsByMonth.has(key)) paymentsByMonth.set(key, []);
  });

  const monthKeys = [...paymentsByMonth.keys()].sort();

  monthKeys.forEach((monthKey) => {
    const monthPayments = (paymentsByMonth.get(monthKey) ?? []).sort((a, b) =>
      paymentSortKey(a).localeCompare(paymentSortKey(b))
    );
    const sampleDate = monthPayments[0]
      ? resolvePaymentPeriod(monthPayments[0])?.start ?? monthPayments[0].created_at
      : `${monthKey}-01`;

    const monthBounds = monthBoundsFromIso(sampleDate);
    if (!monthBounds) return;

    const effectiveStart =
      dateFrom && dateFrom > monthBounds.start ? dateFrom : monthBounds.start;
    const effectiveEnd = dateTo && dateTo < monthBounds.end ? dateTo : monthBounds.end;

    addMonthTitleRow(sheet, monthLabelFromIso(monthBounds.start));

    const monthTotals = { accrued: 0, cash: 0, noncash: 0, paid: 0, debt: 0 };

    monthPayments.forEach((payment) => {
      if (!PAYOUT_TYPES.has(payment.type)) return;

      const period = resolvePaymentPeriod(payment);
      if (!period) return;

      const accrued = calcDriverTripAccrued(db, payment.driver_id, period.start, period.end);
      const amount = asNumber(payment.amount);
      const isNoncash = payment.method === 'noncash';
      const cash = isNoncash ? 0 : amount;
      const noncash = isNoncash ? amount : 0;
      const paidTotal = cash + noncash;
      const debt = paidTotal - accrued;

      const row = sheet.addRow([
        payment.driver_name ?? `#${payment.driver_id}`,
        'Водитель',
        formatPeriodLabel(period.start, period.end),
        formatRuDate(String(payment.created_at).slice(0, 10)),
        formatRuDate(period.start),
        formatRuDate(period.end),
        accrued,
        cash,
        noncash,
        paidTotal,
        debt,
        buildPaymentComment(payment),
      ]);
      styleMoneyCells(row, [7, 8, 9, 10, 11]);

      monthTotals.accrued += accrued;
      monthTotals.cash += cash;
      monthTotals.noncash += noncash;
      monthTotals.paid += paidTotal;
      monthTotals.debt += debt;
    });

    const monthDrivers = fetchDriversWithTripsInMonth(
      db,
      effectiveStart,
      effectiveEnd,
      driverId
    );

    monthDrivers.forEach((driver) => {
      const monthAccrued = calcDriverTripAccrued(
        db,
        driver.driver_id,
        effectiveStart,
        effectiveEnd
      );
      if (monthAccrued <= 0) return;

      const coveredAccrued = monthPayments
        .filter((p) => p.driver_id === driver.driver_id && PAYOUT_TYPES.has(p.type))
        .reduce((sum, payment) => {
          const period = resolvePaymentPeriod(payment);
          if (!period) return sum;
          return sum + calcDriverTripAccrued(db, payment.driver_id, period.start, period.end);
        }, 0);

      const unpaidAccrual = monthAccrued - coveredAccrued;
      if (unpaidAccrual <= 0.009) return;

      const monthPaid = monthPayments
        .filter((p) => p.driver_id === driver.driver_id && PAYOUT_TYPES.has(p.type))
        .reduce((sum, p) => sum + asNumber(p.amount), 0);

      const monthDeductions = calcDriverDeductions(
        db,
        driver.driver_id,
        effectiveStart,
        effectiveEnd
      );

      const remainder = monthAccrued + monthDeductions - monthPaid;
      if (remainder <= 0.009) return;

      const row = sheet.addRow([
        driver.driver_name ?? `#${driver.driver_id}`,
        'Водитель',
        formatPeriodLabel(effectiveStart, effectiveEnd),
        '',
        formatRuDate(effectiveStart),
        formatRuDate(effectiveEnd),
        unpaidAccrual,
        0,
        0,
        0,
        -remainder,
        monthDeductions > 0 ? 'Начислено, не выплачено (с учётом удержаний)' : 'Начислено, не выплачено',
      ]);
      styleMoneyCells(row, [7, 8, 9, 10, 11]);

      monthTotals.accrued += unpaidAccrual;
      monthTotals.debt -= remainder;
    });

    if (monthTotals.accrued !== 0 || monthTotals.paid !== 0) {
      addTotalsRow(sheet, monthTotals);
    }
  });

  sheet.columns.forEach((column, index) => {
    column.width = index === 0 ? 22 : index === 2 || index === 11 ? 24 : 16;
  });

  return workbook;
}

module.exports = {
  buildSalaryTimesheetWorkbook,
};
