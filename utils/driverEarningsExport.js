const ExcelJS = require('exceljs');
const {
  COMPLETED_TRIP_SQL,
  calcDriverCompensations,
  calcDriverDeductions,
  calcDriverSeniorAllowance,
  formatRuDate,
} = require('./salaryCalculations');

const PAYMENT_TYPE_LABELS = {
  salary: 'Зарплата',
  advance: 'Аванс',
  bonus: 'Премия / надбавка',
  deduction: 'Удержание',
};

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

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function fetchDriverProfile(db, driverId) {
  return db
    .prepare(
      `SELECT d.id AS driver_id, u.full_name AS driver_name, d.car_number
       FROM drivers d
       JOIN users u ON u.id = d.user_id
       WHERE d.id = ?`
    )
    .get(driverId);
}

function fetchAllDrivers(db) {
  return db
    .prepare(
      `SELECT d.id AS driver_id, u.full_name AS driver_name, d.car_number
       FROM drivers d
       JOIN users u ON u.id = d.user_id
       ORDER BY u.full_name ASC`
    )
    .all();
}

function fetchDriverTrips(db, driverId, dateFrom, dateTo) {
  const where = [COMPLETED_TRIP_SQL, 't.driver_id = ?'];
  const params = [driverId];
  where.push('date(COALESCE(t.completed_at, t.created_at)) >= date(?)');
  params.push(dateFrom);
  where.push('date(COALESCE(t.completed_at, t.created_at)) <= date(?)');
  params.push(dateTo);

  return db
    .prepare(
      `SELECT
         t.id,
         t.order_id,
         t.ttn_number,
         t.volume,
         t.photo_path,
         date(COALESCE(t.completed_at, t.created_at)) AS trip_date,
         COALESCE(o.driver_rate, 0) AS driver_rate,
         COALESCE(o.material, '') AS material,
         COALESCE(o.task_name, c.name, '') AS customer_name
       FROM trips t
       JOIN orders o ON o.id = t.order_id
       LEFT JOIN contractors c ON c.id = o.contractor_id
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(t.completed_at, t.created_at) ASC, t.id ASC`
    )
    .all(...params)
    .map((row) => {
      const photoAvailable = Boolean(row.photo_path && String(row.photo_path).trim());
      return {
        ...row,
        counted_in_salary: photoAvailable,
        driver_rate: asNumber(row.driver_rate),
        volume: row.volume == null ? null : asNumber(row.volume),
      };
    });
}

function fetchDriverCompensations(db, driverId, dateFrom, dateTo) {
  return db
    .prepare(
      `SELECT
         e.id,
         e.exp_date,
         e.exp_type,
         e.amount,
         COALESCE(e.comment, '') AS comment,
         COALESCE(e.status, 'approved') AS status
       FROM expenses e
       WHERE e.driver_id = ?
         AND e.source = 'driver'
         AND e.status = 'approved'
         AND date(e.exp_date) >= date(?)
         AND date(e.exp_date) <= date(?)
       ORDER BY e.exp_date ASC, e.id ASC`
    )
    .all(driverId, dateFrom, dateTo);
}

function fetchDriverPayments(db, driverId, dateFrom, dateTo) {
  return db
    .prepare(
      `SELECT
         p.id,
         p.type,
         p.amount,
         p.method,
         p.note,
         p.period_start,
         p.period_end,
         date(p.created_at) AS payment_date
       FROM driver_payments p
       WHERE p.driver_id = ?
         AND date(COALESCE(p.period_end, p.created_at)) >= date(?)
         AND date(COALESCE(p.period_start, p.created_at)) <= date(?)
       ORDER BY COALESCE(p.period_start, p.created_at) ASC, p.id ASC`
    )
    .all(driverId, dateFrom, dateTo);
}

function buildDriverEarningsReport(db, driverId, dateFrom, dateTo) {
  const profile = fetchDriverProfile(db, driverId);
  if (!profile) return null;

  const trips = fetchDriverTrips(db, driverId, dateFrom, dateTo);
  const compensations = fetchDriverCompensations(db, driverId, dateFrom, dateTo);
  const payments = fetchDriverPayments(db, driverId, dateFrom, dateTo);

  const eligibleTrips = trips.filter((trip) => trip.counted_in_salary);
  const tripEarnings = eligibleTrips.reduce((sum, trip) => sum + trip.driver_rate, 0);
  const compensationsTotal = calcDriverCompensations(db, driverId, dateFrom, dateTo);
  const seniorAllowance = calcDriverSeniorAllowance(db, driverId, dateFrom, dateTo);
  const deductionsTotal = calcDriverDeductions(db, driverId, dateFrom, dateTo);

  const paidSalary = payments
    .filter((p) => ['salary', 'advance', 'bonus'].includes(p.type))
    .reduce((sum, p) => sum + asNumber(p.amount), 0);

  const bonuses = payments
    .filter((p) => p.type === 'bonus')
    .reduce((sum, p) => sum + asNumber(p.amount), 0);

  const advances = payments
    .filter((p) => p.type === 'advance')
    .reduce((sum, p) => sum + asNumber(p.amount), 0);

  const gross = tripEarnings + compensationsTotal + seniorAllowance;
  const totalEarnings = gross;
  const debt = gross - deductionsTotal - paidSalary;

  return {
    profile,
    period: { dateFrom, dateTo },
    summary: {
      total_trips: trips.length,
      eligible_trips: eligibleTrips.length,
      ineligible_trips: trips.length - eligibleTrips.length,
      total_volume: trips.reduce((sum, trip) => sum + (trip.volume ?? 0), 0),
      trip_earnings: tripEarnings,
      senior_allowance: seniorAllowance,
      compensations: compensationsTotal,
      bonuses,
      advances,
      deductions: deductionsTotal,
      paid: paidSalary,
      total_earnings: totalEarnings,
      debt,
    },
    trips,
    compensations,
    payments,
  };
}

function buildDriverEarningsWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  const { profile, period, summary } = report;

  const summarySheet = workbook.addWorksheet('Сводка');
  addHeaderRow(summarySheet, ['Показатель', 'Значение']);
  summarySheet.addRow(['Водитель', profile.driver_name ?? '']);
  summarySheet.addRow(['Машина', profile.car_number ?? '']);
  summarySheet.addRow([
    'Период',
    `${formatRuDate(period.dateFrom)} — ${formatRuDate(period.dateTo)}`,
  ]);
  summarySheet.addRow(['Рейсов всего', summary.total_trips]);
  summarySheet.addRow(['Зачтено в зарплату (с фото ТТН)', summary.eligible_trips]);
  summarySheet.addRow(['Не зачтено (без фото)', summary.ineligible_trips]);
  summarySheet.addRow(['Объём', summary.total_volume]);
  summarySheet.addRow(['Заработок по рейсам', summary.trip_earnings]);
  summarySheet.addRow(['Старший (надбавка за вахты)', summary.senior_allowance]);
  summarySheet.addRow(['Компенсации (одобренные)', summary.compensations]);
  summarySheet.addRow(['Премии (выплаты)', summary.bonuses]);
  summarySheet.addRow(['Авансы', summary.advances]);
  summarySheet.addRow(['Удержания', summary.deductions]);
  summarySheet.addRow(['Выплачено (итого)', summary.paid]);
  summarySheet.addRow(['Итого к начислению', summary.total_earnings]);
  summarySheet.addRow(['Долг / к выплате', summary.debt]);
  summarySheet.columns = [{ width: 34 }, { width: 24 }];

  const tripsSheet = workbook.addWorksheet('Рейсы');
  addHeaderRow(tripsSheet, [
    'Дата',
    '№ рейса',
    'Заказ',
    'ТТН',
    'Материал',
    'Заказчик',
    'Объём',
    'Ставка',
    'Зачтён',
  ]);
  report.trips.forEach((trip) => {
    tripsSheet.addRow([
      trip.trip_date ?? '',
      trip.id,
      trip.order_id,
      trip.ttn_number ?? '',
      trip.material ?? '',
      trip.customer_name ?? '',
      trip.volume ?? '',
      trip.driver_rate,
      trip.counted_in_salary ? 'Да' : 'Нет',
    ]);
  });
  tripsSheet.columns.forEach((column) => {
    column.width = 14;
  });

  const compSheet = workbook.addWorksheet('Компенсации');
  addHeaderRow(compSheet, ['Дата', 'Тип', 'Сумма', 'Комментарий']);
  report.compensations.forEach((row) => {
    compSheet.addRow([row.exp_date ?? '', row.exp_type ?? '', asNumber(row.amount), row.comment ?? '']);
  });
  compSheet.columns = [{ width: 14 }, { width: 18 }, { width: 14 }, { width: 36 }];

  const paySheet = workbook.addWorksheet('Выплаты и премии');
  addHeaderRow(paySheet, [
    'Дата',
    'Тип',
    'Сумма',
    'Способ',
    'Период с',
    'Период по',
    'Комментарий',
  ]);
  report.payments.forEach((row) => {
    paySheet.addRow([
      row.payment_date ?? '',
      PAYMENT_TYPE_LABELS[row.type] || row.type,
      asNumber(row.amount),
      row.method === 'noncash' ? 'Безнал' : row.method === 'cash' ? 'Нал' : '',
      row.period_start ? formatRuDate(row.period_start) : '',
      row.period_end ? formatRuDate(row.period_end) : '',
      row.note ?? '',
    ]);
  });
  paySheet.columns.forEach((column) => {
    column.width = 16;
  });

  return workbook;
}

module.exports = {
  fetchAllDrivers,
  buildDriverEarningsReport,
  buildDriverEarningsWorkbook,
};
