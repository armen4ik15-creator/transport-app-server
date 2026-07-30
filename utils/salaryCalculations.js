const COMPLETED_TRIP_SQL =
  "(t.status = 'completed' OR (t.status IS NULL AND t.stage = 'unloading'))";

/** Рейс учитывается в зарплате только при наличии фото ТТН в БД. */
const SALARY_ELIGIBLE_TRIP_SQL =
  "(t.photo_path IS NOT NULL AND TRIM(t.photo_path) != '')";

/**
 * Зарплата: учитываем рейс, если в БД есть photo_path.
 * Не проверяем S3 HeadObject — он на Timeweb занимает 10–15с и вешает API.
 * Факт успешной загрузки = запись пути после PutObject.
 */
function isTripSalaryEligible(trip) {
  if (!trip) return false;
  const photoPath = trip.photo_path ? String(trip.photo_path).trim() : '';
  return Boolean(photoPath);
}

async function isTripSalaryEligibleAsync(trip) {
  return isTripSalaryEligible(trip);
}

async function isPhotoAvailableAsync(photoPath) {
  const normalized = photoPath ? String(photoPath).trim() : '';
  return Boolean(normalized);
}

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function calcDriverTripAccrued(db, driverId, dateFrom, dateTo) {
  if (!driverId || !dateFrom || !dateTo) return 0;

  const where = [COMPLETED_TRIP_SQL, 't.driver_id = ?'];
  const params = [driverId];

  where.push('date(COALESCE(t.completed_at, t.created_at)) >= date(?)');
  params.push(dateFrom);
  where.push('date(COALESCE(t.completed_at, t.created_at)) <= date(?)');
  params.push(dateTo);

  const rows = db
    .prepare(
      `SELECT t.photo_path, COALESCE(o.driver_rate, 0) AS driver_rate
       FROM trips t
       JOIN orders o ON o.id = t.order_id
       WHERE ${where.join(' AND ')}`
    )
    .all(...params);

  return rows.reduce(
    (sum, row) => sum + (isTripSalaryEligible(row) ? asNumber(row.driver_rate) : 0),
    0
  );
}

async function calcDriverTripAccruedAsync(db, driverId, dateFrom, dateTo) {
  if (!driverId || !dateFrom || !dateTo) return 0;

  const where = [COMPLETED_TRIP_SQL, 't.driver_id = ?'];
  const params = [driverId];

  where.push('date(COALESCE(t.completed_at, t.created_at)) >= date(?)');
  params.push(dateFrom);
  where.push('date(COALESCE(t.completed_at, t.created_at)) <= date(?)');
  params.push(dateTo);

  const rows = db
    .prepare(
      `SELECT t.photo_path, COALESCE(o.driver_rate, 0) AS driver_rate
       FROM trips t
       JOIN orders o ON o.id = t.order_id
       WHERE ${where.join(' AND ')}`
    )
    .all(...params);

  let total = 0;
  for (const row of rows) {
    if (await isTripSalaryEligibleAsync(row)) {
      total += asNumber(row.driver_rate);
    }
  }
  return total;
}

function calcDriverDeductions(db, driverId, dateFrom, dateTo) {
  if (!driverId || !dateFrom || !dateTo) return 0;

  const where = ["p.type = 'deduction'", 'p.driver_id = ?'];
  const params = [driverId];

  where.push('date(COALESCE(p.period_end, p.created_at)) >= date(?)');
  params.push(dateFrom);
  where.push('date(COALESCE(p.period_start, p.created_at)) <= date(?)');
  params.push(dateTo);

  const row = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS total
       FROM driver_payments p
       WHERE ${where.join(' AND ')}`
    )
    .get(...params);

  return asNumber(row?.total);
}

function getDriverSeniorShiftBonus(db, driverId) {
  if (!driverId) return 0;
  try {
    const row = db
      .prepare(
        `SELECT COALESCE(senior_shift_bonus, 0) AS senior_shift_bonus
         FROM drivers WHERE id = ?`
      )
      .get(driverId);
    return asNumber(row?.senior_shift_bonus);
  } catch {
    return 0;
  }
}

/**
 * Надбавка «старший водитель»: senior_shift_bonus × число вахт в периоде,
 * в которых у водителя был хотя бы один завершённый рейс.
 */
function calcDriverSeniorAllowance(db, driverId, dateFrom, dateTo) {
  const perShift = getDriverSeniorShiftBonus(db, driverId);
  if (perShift <= 0 || !dateFrom || !dateTo) return 0;

  try {
    // Сначала сужаем диапазон по фактическим рейсам — без перебора всего календаря.
    const bounds = db
      .prepare(
        `SELECT
           MIN(date(COALESCE(t.completed_at, t.created_at))) AS min_d,
           MAX(date(COALESCE(t.completed_at, t.created_at))) AS max_d
         FROM trips t
         WHERE t.driver_id = ?
           AND ${COMPLETED_TRIP_SQL}
           AND date(COALESCE(t.completed_at, t.created_at)) >= date(?)
           AND date(COALESCE(t.completed_at, t.created_at)) <= date(?)`
      )
      .get(driverId, dateFrom, dateTo);

    const minDate = bounds?.min_d ? String(bounds.min_d).slice(0, 10) : null;
    const maxDate = bounds?.max_d ? String(bounds.max_d).slice(0, 10) : null;
    if (!minDate || !maxDate) return 0;

    const { listShiftsOverlappingRange } = require('./salaryShiftPeriods');
    const shifts = listShiftsOverlappingRange(minDate, maxDate);
    let total = 0;
    for (const shift of shifts) {
      const row = db
        .prepare(
          `SELECT 1 AS ok
           FROM trips t
           WHERE t.driver_id = ?
             AND ${COMPLETED_TRIP_SQL}
             AND date(COALESCE(t.completed_at, t.created_at)) >= date(?)
             AND date(COALESCE(t.completed_at, t.created_at)) <= date(?)
           LIMIT 1`
        )
        .get(driverId, shift.effectiveFrom, shift.effectiveTo);
      if (row) total += perShift;
    }
    return total;
  } catch (error) {
    console.error('[salary] calcDriverSeniorAllowance failed:', error.message);
    return 0;
  }
}

function calcDriverCompensations(db, driverId, dateFrom, dateTo) {
  if (!driverId || !dateFrom || !dateTo) return 0;

  const where = ["e.source = 'driver'", "e.status = 'approved'", 'e.driver_id = ?'];
  const params = [driverId];

  where.push('date(e.exp_date) >= date(?)');
  params.push(dateFrom);
  where.push('date(e.exp_date) <= date(?)');
  params.push(dateTo);

  const row = db
    .prepare(
      `SELECT COALESCE(SUM(e.amount), 0) AS total
       FROM expenses e
       WHERE ${where.join(' AND ')}`
    )
    .get(...params);

  return asNumber(row?.total);
}

function calcDriverPayouts(db, driverId, dateFrom, dateTo) {
  if (!driverId || !dateFrom || !dateTo) return 0;

  const where = ["p.type IN ('salary','advance','bonus')", 'p.driver_id = ?'];
  const params = [driverId];

  where.push('date(COALESCE(p.period_end, p.created_at)) >= date(?)');
  params.push(dateFrom);
  where.push('date(COALESCE(p.period_start, p.created_at)) <= date(?)');
  params.push(dateTo);

  const row = db
    .prepare(
      `SELECT COALESCE(SUM(p.amount), 0) AS total
       FROM driver_payments p
       WHERE ${where.join(' AND ')}`
    )
    .get(...params);

  return asNumber(row?.total);
}

function parseIsoDate(value) {
  if (!value) return null;
  const date = new Date(String(value).slice(0, 10));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function monthBoundsFromIso(isoDate) {
  const date = parseIsoDate(isoDate);
  if (!date) return null;
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start: toIsoDate(start), end: toIsoDate(end) };
}

function resolvePaymentPeriod(payment) {
  const start = payment.period_start ? String(payment.period_start).slice(0, 10) : null;
  const end = payment.period_end ? String(payment.period_end).slice(0, 10) : null;

  if (start && end && start <= end) {
    return { start, end };
  }

  const anchor = String(payment.created_at ?? '').slice(0, 10);
  const bounds = monthBoundsFromIso(anchor);
  if (!bounds) return null;
  return bounds;
}

function formatRuDate(isoDate) {
  const date = parseIsoDate(isoDate);
  if (!date) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

function formatPeriodLabel(startIso, endIso) {
  const start = formatRuDate(startIso);
  const end = formatRuDate(endIso);
  if (!start || !end) return '';
  return `${start} — ${end}`;
}

const MONTH_NAMES = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

function monthLabelFromIso(isoDate) {
  const date = parseIsoDate(isoDate);
  if (!date) return '';
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function monthKeyFromIso(isoDate) {
  const date = parseIsoDate(isoDate);
  if (!date) return null;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

module.exports = {
  COMPLETED_TRIP_SQL,
  SALARY_ELIGIBLE_TRIP_SQL,
  isTripSalaryEligible,
  isTripSalaryEligibleAsync,
  isPhotoAvailableAsync,
  asNumber,
  calcDriverTripAccrued,
  calcDriverTripAccruedAsync,
  calcDriverCompensations,
  calcDriverDeductions,
  calcDriverPayouts,
  calcDriverSeniorAllowance,
  getDriverSeniorShiftBonus,
  formatPeriodLabel,
  formatRuDate,
  monthBoundsFromIso,
  monthKeyFromIso,
  monthLabelFromIso,
  parseIsoDate,
  resolvePaymentPeriod,
  toIsoDate,
};
