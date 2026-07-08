const COMPLETED_TRIP_SQL =
  "(t.status = 'completed' OR (t.status IS NULL AND t.stage = 'unloading'))";

/** Рейс учитывается в зарплате только при наличии фото ТТН. */
const SALARY_ELIGIBLE_TRIP_SQL =
  "(t.photo_path IS NOT NULL AND TRIM(t.photo_path) != '')";

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function calcDriverTripAccrued(db, driverId, dateFrom, dateTo) {
  if (!driverId || !dateFrom || !dateTo) return 0;

  const where = [COMPLETED_TRIP_SQL, SALARY_ELIGIBLE_TRIP_SQL, 't.driver_id = ?'];
  const params = [driverId];

  where.push('date(COALESCE(t.completed_at, t.created_at)) >= date(?)');
  params.push(dateFrom);
  where.push('date(COALESCE(t.completed_at, t.created_at)) <= date(?)');
  params.push(dateTo);

  const row = db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(o.driver_rate, 0)), 0) AS accrued
       FROM trips t
       JOIN orders o ON o.id = t.order_id
       WHERE ${where.join(' AND ')}`
    )
    .get(...params);

  return asNumber(row?.accrued);
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
  asNumber,
  calcDriverTripAccrued,
  calcDriverCompensations,
  calcDriverDeductions,
  calcDriverPayouts,
  formatPeriodLabel,
  formatRuDate,
  monthBoundsFromIso,
  monthKeyFromIso,
  monthLabelFromIso,
  parseIsoDate,
  resolvePaymentPeriod,
  toIsoDate,
};
