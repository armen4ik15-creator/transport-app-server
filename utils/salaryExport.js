const ExcelJS = require('exceljs');
const {
  asNumber,
  calcDriverCompensations,
  calcDriverDeductions,
  calcDriverTripAccrued,
  formatPeriodLabel,
  formatRuDate,
  parseIsoDate,
  resolvePaymentPeriod,
  toIsoDate,
} = require('./salaryCalculations');
const { shiftPeriodBounds } = require('./salaryShiftPeriods');

const COMPLETED_TRIP_SQL =
  "(t.status = 'completed' OR (t.status IS NULL AND t.stage = 'unloading'))";

const PAYOUT_TYPES = new Set(['salary', 'advance', 'bonus']);

const SUMMARY_HEADERS = [
  'Сотрудник',
  'Должность',
  'Вахта',
  'Начало',
  'Конец',
  'Реестр (рейсы), ₽',
  'Компенсации, ₽',
  'Премии / надбавки (выплаты), ₽',
  'Удержания, ₽',
  'Итого начислено, ₽',
  'Выплачено (нал), ₽',
  'Выплачено (безнал), ₽',
  'Итого выплата, ₽',
  'Долг / переплата, ₽',
  'Дата выплаты',
  'Комментарий',
];

const TRIP_HEADERS = [
  'Сотрудник',
  'Вахта',
  'Дата рейса',
  'Заказ',
  'ТТН',
  'Материал',
  'Объём',
  'Ставка водителя, ₽',
  'Учтён в ЗП',
  'Примечание',
];

const COMP_HEADERS = [
  'Сотрудник',
  'Вахта',
  'Дата расхода',
  'Тип',
  'Сумма, ₽',
  'Комментарий',
];

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

function addSectionTitle(sheet, label, colCount) {
  const row = sheet.addRow([label]);
  row.font = { bold: true, size: 12 };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFDCE6F7' },
  };
  sheet.mergeCells(row.number, 1, row.number, colCount);
}

function listShiftsInRange(dateFrom, dateTo) {
  const start = parseIsoDate(dateFrom);
  const end = parseIsoDate(dateTo);
  if (!start || !end || start > end) return [];

  const shifts = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cursor <= last) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth() + 1;
    for (const shiftNum of [1, 2]) {
      const shift = shiftPeriodBounds(year, month, shiftNum);
      if (!shift) continue;
      if (shift.dateTo < dateFrom || shift.dateFrom > dateTo) continue;
      const from = dateFrom > shift.dateFrom ? dateFrom : shift.dateFrom;
      const to = dateTo < shift.dateTo ? dateTo : shift.dateTo;
      shifts.push({
        ...shift,
        effectiveFrom: from,
        effectiveTo: to,
        label: formatPeriodLabel(from, to),
      });
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return shifts;
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
         p.id, p.driver_id, p.type, p.amount, p.method, p.note,
         p.period_start, p.period_end, p.created_at,
         u.full_name AS driver_name
       FROM driver_payments p
       JOIN drivers d ON d.id = p.driver_id
       JOIN users u ON u.id = d.user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY COALESCE(p.period_start, p.created_at) ASC, p.id ASC`
    )
    .all(...params);
}

function paymentOverlapsPeriod(payment, from, to) {
  const period = resolvePaymentPeriod(payment);
  if (!period) return false;
  return period.end >= from && period.start <= to;
}

function fetchDriversForShift(db, from, to, driverId) {
  const ids = new Map();

  const tripRows = db
    .prepare(
      `SELECT DISTINCT t.driver_id, u.full_name AS driver_name
       FROM trips t
       JOIN drivers d ON d.id = t.driver_id
       JOIN users u ON u.id = d.user_id
       WHERE ${COMPLETED_TRIP_SQL}
         AND date(COALESCE(t.completed_at, t.created_at)) >= date(?)
         AND date(COALESCE(t.completed_at, t.created_at)) <= date(?)
         ${driverId ? 'AND t.driver_id = ?' : ''}
       ORDER BY u.full_name ASC`
    )
    .all(...(driverId ? [from, to, driverId] : [from, to]));

  tripRows.forEach((row) => ids.set(row.driver_id, row.driver_name));

  const expenseRows = db
    .prepare(
      `SELECT DISTINCT e.driver_id, u.full_name AS driver_name
       FROM expenses e
       JOIN drivers d ON d.id = e.driver_id
       JOIN users u ON u.id = d.user_id
       WHERE e.source = 'driver'
         AND e.status = 'approved'
         AND date(e.exp_date) >= date(?)
         AND date(e.exp_date) <= date(?)
         ${driverId ? 'AND e.driver_id = ?' : ''}
       ORDER BY u.full_name ASC`
    )
    .all(...(driverId ? [from, to, driverId] : [from, to]));

  expenseRows.forEach((row) => {
    if (!ids.has(row.driver_id)) ids.set(row.driver_id, row.driver_name);
  });

  return [...ids.entries()].map(([id, name]) => ({ driver_id: id, driver_name: name }));
}

function fetchTripsDetail(db, from, to, driverId) {
  const where = [
    COMPLETED_TRIP_SQL,
    'date(COALESCE(t.completed_at, t.created_at)) >= date(?)',
    'date(COALESCE(t.completed_at, t.created_at)) <= date(?)',
  ];
  const params = [from, to];
  if (driverId) {
    where.push('t.driver_id = ?');
    params.push(driverId);
  }

  return db
    .prepare(
      `SELECT
         t.id,
         t.driver_id,
         u.full_name AS driver_name,
         t.order_id,
         t.ttn_number,
         t.volume,
         t.photo_path,
         date(COALESCE(t.completed_at, t.created_at)) AS trip_date,
         COALESCE(o.driver_rate, 0) AS driver_rate,
         COALESCE(o.material, '') AS material
       FROM trips t
       JOIN drivers d ON d.id = t.driver_id
       JOIN users u ON u.id = d.user_id
       JOIN orders o ON o.id = t.order_id
       WHERE ${where.join(' AND ')}
       ORDER BY u.full_name ASC, COALESCE(t.completed_at, t.created_at) ASC, t.id ASC`
    )
    .all(...params);
}

function fetchCompensationsDetail(db, from, to, driverId) {
  const where = [
    "e.source = 'driver'",
    "e.status = 'approved'",
    'date(e.exp_date) >= date(?)',
    'date(e.exp_date) <= date(?)',
  ];
  const params = [from, to];
  if (driverId) {
    where.push('e.driver_id = ?');
    params.push(driverId);
  }

  return db
    .prepare(
      `SELECT
         e.id,
         e.driver_id,
         u.full_name AS driver_name,
         e.exp_date,
         e.exp_type,
         e.amount,
         COALESCE(e.comment, '') AS comment
       FROM expenses e
       JOIN drivers d ON d.id = e.driver_id
       JOIN users u ON u.id = d.user_id
       WHERE ${where.join(' AND ')}
       ORDER BY u.full_name ASC, e.exp_date ASC, e.id ASC`
    )
    .all(...params);
}

function sumPaymentsForDriver(payments, driverId, from, to) {
  const rows = payments.filter(
    (p) => p.driver_id === driverId && paymentOverlapsPeriod(p, from, to)
  );

  let cash = 0;
  let noncash = 0;
  let bonuses = 0;
  let advances = 0;
  let salary = 0;
  const dates = [];
  const notes = [];

  rows.forEach((p) => {
    const amount = asNumber(p.amount);
    if (PAYOUT_TYPES.has(p.type)) {
      if (p.method === 'noncash') noncash += amount;
      else cash += amount;
      if (p.type === 'bonus') bonuses += amount;
      if (p.type === 'advance') advances += amount;
      if (p.type === 'salary') salary += amount;
      dates.push(formatRuDate(String(p.created_at).slice(0, 10)));
      if (p.note) notes.push(String(p.note));
      if (p.type === 'bonus') notes.push('Премия');
      if (p.type === 'advance') notes.push('Аванс');
    }
  });

  return {
    cash,
    noncash,
    paid: cash + noncash,
    bonuses,
    advances,
    salary,
    paymentDate: [...new Set(dates)].join(', '),
    comment: [...new Set(notes)].join(' · '),
  };
}

function buildDriverShiftRow(db, driver, shift, payments) {
  const from = shift.effectiveFrom;
  const to = shift.effectiveTo;
  const registry = calcDriverTripAccrued(db, driver.driver_id, from, to);
  const compensations = calcDriverCompensations(db, driver.driver_id, from, to);
  const deductions = calcDriverDeductions(db, driver.driver_id, from, to);
  const payout = sumPaymentsForDriver(payments, driver.driver_id, from, to);

  // Начислено за вахту: реестр + компенсации.
  // Удержания и премии (выплаты bonus) — отдельно; долг как в salary/summary.
  const accruedTotal = registry + compensations;
  const debt = accruedTotal + deductions - payout.paid;

  const comments = [];
  if (payout.comment) comments.push(payout.comment);
  if (registry <= 0 && payout.paid > 0) {
    comments.push(
      'Выплата без начислений в реестре приложения (период до старта учёта или вне рейсов)'
    );
  }
  if (registry > 0 && payout.paid <= 0) {
    comments.push('Начислено, не выплачено');
  }

  return {
    driver_name: driver.driver_name ?? `#${driver.driver_id}`,
    shift_label: shift.label,
    from,
    to,
    registry,
    compensations,
    bonuses: payout.bonuses,
    deductions,
    accruedTotal,
    cash: payout.cash,
    noncash: payout.noncash,
    paid: payout.paid,
    debt,
    paymentDate: payout.paymentDate,
    comment: comments.join(' · '),
    hasActivity:
      registry > 0 ||
      compensations > 0 ||
      deductions !== 0 ||
      payout.paid > 0,
  };
}

function buildSalaryTimesheetWorkbook(db, { dateFrom, dateTo, driverId }) {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet('Табель по вахтам');
  const tripsSheet = workbook.addWorksheet('Рейсы (реестр)');
  const compsSheet = workbook.addWorksheet('Компенсации');

  addHeaderRow(summary, SUMMARY_HEADERS);
  addHeaderRow(tripsSheet, TRIP_HEADERS);
  addHeaderRow(compsSheet, COMP_HEADERS);

  const rangeFrom = dateFrom || '1970-01-01';
  const rangeTo = dateTo || toIsoDate(new Date());
  const shifts = listShiftsInRange(rangeFrom, rangeTo);
  const payments = fetchPayments(db, { dateFrom: rangeFrom, dateTo: rangeTo, driverId });

  const grand = {
    registry: 0,
    compensations: 0,
    bonuses: 0,
    deductions: 0,
    accruedTotal: 0,
    cash: 0,
    noncash: 0,
    paid: 0,
    debt: 0,
  };

  shifts.forEach((shift) => {
    addSectionTitle(
      summary,
      `${shift.title} · ${formatPeriodLabel(shift.effectiveFrom, shift.effectiveTo)}`,
      SUMMARY_HEADERS.length
    );

    const drivers = fetchDriversForShift(
      db,
      shift.effectiveFrom,
      shift.effectiveTo,
      driverId
    );

    // Водители только с выплатами за эту вахту (без рейсов в приложении) — тоже в табель.
    const paymentDriverIds = new Set(drivers.map((d) => d.driver_id));
    payments.forEach((p) => {
      if (!PAYOUT_TYPES.has(p.type)) return;
      if (!paymentOverlapsPeriod(p, shift.effectiveFrom, shift.effectiveTo)) return;
      if (driverId && p.driver_id !== driverId) return;
      if (paymentDriverIds.has(p.driver_id)) return;
      paymentDriverIds.add(p.driver_id);
      drivers.push({ driver_id: p.driver_id, driver_name: p.driver_name });
    });

    drivers.sort((a, b) =>
      String(a.driver_name || '').localeCompare(String(b.driver_name || ''), 'ru')
    );

    const shiftTotals = {
      registry: 0,
      compensations: 0,
      bonuses: 0,
      deductions: 0,
      accruedTotal: 0,
      cash: 0,
      noncash: 0,
      paid: 0,
      debt: 0,
    };

    drivers.forEach((driver) => {
      const rowData = buildDriverShiftRow(db, driver, shift, payments);
      if (!rowData.hasActivity) return;

      const row = summary.addRow([
        rowData.driver_name,
        'Водитель',
        rowData.shift_label,
        formatRuDate(rowData.from),
        formatRuDate(rowData.to),
        rowData.registry,
        rowData.compensations,
        rowData.bonuses,
        rowData.deductions,
        rowData.accruedTotal,
        rowData.cash,
        rowData.noncash,
        rowData.paid,
        rowData.debt,
        rowData.paymentDate,
        rowData.comment,
      ]);
      styleMoneyCells(row, [6, 7, 8, 9, 10, 11, 12, 13, 14]);

      Object.keys(shiftTotals).forEach((key) => {
        shiftTotals[key] += rowData[key];
        grand[key] += rowData[key];
      });
    });

    if (
      shiftTotals.registry !== 0 ||
      shiftTotals.compensations !== 0 ||
      shiftTotals.paid !== 0
    ) {
      const totalRow = summary.addRow([
        'ИТОГО по вахте',
        '',
        '',
        '',
        '',
        shiftTotals.registry,
        shiftTotals.compensations,
        shiftTotals.bonuses,
        shiftTotals.deductions,
        shiftTotals.accruedTotal,
        shiftTotals.cash,
        shiftTotals.noncash,
        shiftTotals.paid,
        shiftTotals.debt,
        '',
        '',
      ]);
      totalRow.font = { bold: true };
      styleMoneyCells(totalRow, [6, 7, 8, 9, 10, 11, 12, 13, 14]);
    }
  });

  if (grand.registry !== 0 || grand.paid !== 0 || grand.compensations !== 0) {
    addSectionTitle(summary, 'ИТОГО за выбранный период', SUMMARY_HEADERS.length);
    const grandRow = summary.addRow([
      'ИТОГО',
      '',
      '',
      '',
      '',
      grand.registry,
      grand.compensations,
      grand.bonuses,
      grand.deductions,
      grand.accruedTotal,
      grand.cash,
      grand.noncash,
      grand.paid,
      grand.debt,
      '',
      '',
    ]);
    grandRow.font = { bold: true };
    styleMoneyCells(grandRow, [6, 7, 8, 9, 10, 11, 12, 13, 14]);
  }

  // Детализация рейсов — чтобы было видно, из чего сложился реестр (напр. 134 500).
  const tripRows = fetchTripsDetail(db, rangeFrom, rangeTo, driverId);
  tripRows.forEach((trip) => {
    const counted = Boolean(trip.photo_path && String(trip.photo_path).trim());
    const shift =
      listShiftsInRange(trip.trip_date, trip.trip_date)[0] ||
      null;
    tripsSheet.addRow([
      trip.driver_name,
      shift ? formatPeriodLabel(shift.dateFrom, shift.dateTo) : '',
      formatRuDate(trip.trip_date),
      trip.order_id ?? '',
      trip.ttn_number ?? '',
      trip.material ?? '',
      trip.volume == null ? '' : asNumber(trip.volume),
      asNumber(trip.driver_rate),
      counted ? 'да' : 'нет (нет фото ТТН)',
      counted ? '' : 'Не входит в начисление ЗП',
    ]);
  });

  const lastTrip = tripsSheet.addRow([
    'ИТОГО учтённых в ЗП',
    '',
    '',
    '',
    '',
    '',
    '',
    tripRows
      .filter((t) => t.photo_path && String(t.photo_path).trim())
      .reduce((sum, t) => sum + asNumber(t.driver_rate), 0),
    '',
    '',
  ]);
  lastTrip.font = { bold: true };
  styleMoneyCells(lastTrip, [8]);

  const compRows = fetchCompensationsDetail(db, rangeFrom, rangeTo, driverId);
  compRows.forEach((row) => {
    const shift = listShiftsInRange(row.exp_date, row.exp_date)[0] || null;
    compsSheet.addRow([
      row.driver_name,
      shift ? formatPeriodLabel(shift.dateFrom, shift.dateTo) : '',
      formatRuDate(row.exp_date),
      row.exp_type,
      asNumber(row.amount),
      row.comment,
    ]);
  });
  if (compRows.length) {
    const compTotal = compsSheet.addRow([
      'ИТОГО',
      '',
      '',
      '',
      compRows.reduce((sum, r) => sum + asNumber(r.amount), 0),
      '',
    ]);
    compTotal.font = { bold: true };
    styleMoneyCells(compTotal, [5]);
  }

  summary.columns.forEach((column, index) => {
    column.width = index === 0 || index === 15 ? 28 : index === 2 ? 22 : 14;
  });
  tripsSheet.columns.forEach((column, index) => {
    column.width = index === 0 || index === 9 ? 24 : 14;
  });
  compsSheet.columns.forEach((column, index) => {
    column.width = index === 0 || index === 5 ? 28 : 14;
  });

  return workbook;
}

module.exports = {
  buildSalaryTimesheetWorkbook,
  listShiftsInRange,
};
