const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const {
  calcDriverCompensations,
  calcDriverDeductions,
  calcDriverTripAccrued,
  parseIsoDate,
  resolvePaymentPeriod,
} = require('../utils/salaryCalculations');

const router = express.Router();
router.use(authMiddleware, requireRole('admin'));

const PAYMENT_SELECT = `
  SELECT
    p.id, p.driver_id, p.type, p.amount, p.method, p.note,
    p.period_start, p.period_end, p.created_by, p.created_at,
    u.full_name AS driver_name,
    d.car_number AS driver_car_number
  FROM driver_payments p
  JOIN drivers d ON d.id = p.driver_id
  JOIN users u ON u.id = d.user_id
`;

function validatePeriod(startRaw, endRaw) {
  const start = startRaw ? String(startRaw).slice(0, 10) : null;
  const end = endRaw ? String(endRaw).slice(0, 10) : null;

  if (!start || !end) {
    return { error: 'period_start и period_end обязательны (YYYY-MM-DD)' };
  }
  if (!parseIsoDate(start) || !parseIsoDate(end)) {
    return { error: 'Некорректный формат периода' };
  }
  if (start > end) {
    return { error: 'Начало периода не может быть позже конца' };
  }
  return { start, end };
}

function validateMethod(method, type) {
  if (type === 'deduction') return { method: null };
  const normalized = method === 'noncash' ? 'noncash' : 'cash';
  return { method: normalized };
}

router.get('/payments', (req, res) => {
  const driverId = req.query.driver_id ? Number(req.query.driver_id) : null;
  const where = [];
  const params = [];
  if (driverId) {
    where.push('p.driver_id = ?');
    params.push(driverId);
  }
  const rows = db
    .prepare(`${PAYMENT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.created_at DESC`)
    .all(...params);
  return res.json(rows);
});

router.get('/accrued', (req, res) => {
  const driverId = Number(req.query.driver_id);
  const from = req.query.from ? String(req.query.from).slice(0, 10) : null;
  const to = req.query.to ? String(req.query.to).slice(0, 10) : null;

  if (!Number.isFinite(driverId) || driverId <= 0) {
    return res.status(400).json({ error: 'driver_id обязателен' });
  }
  if (!from || !to) {
    return res.status(400).json({ error: 'from и to обязательны (YYYY-MM-DD)' });
  }

  const driver = db.prepare('SELECT id FROM drivers WHERE id = ?').get(driverId);
  if (!driver) return res.status(404).json({ error: 'Водитель не найден' });

  const accrued = calcDriverTripAccrued(db, driverId, from, to);
  const compensations = calcDriverCompensations(db, driverId, from, to);
  const deductions = calcDriverDeductions(db, driverId, from, to);

  return res.json({
    driver_id: driverId,
    from,
    to,
    accrued,
    compensations,
    deductions,
    net: accrued + compensations + deductions,
  });
});

router.post('/payments', (req, res) => {
  const { driver_id, type, amount, note, method, period_start, period_end } = req.body || {};
  if (!driver_id || !type || amount == null) {
    return res.status(400).json({ error: 'driver_id, type и amount обязательны' });
  }
  if (!['salary', 'advance', 'bonus', 'deduction'].includes(type)) {
    return res.status(400).json({ error: 'type должен быть salary, advance, bonus или deduction' });
  }

  const driver = db.prepare('SELECT id FROM drivers WHERE id = ?').get(driver_id);
  if (!driver) return res.status(404).json({ error: 'Водитель не найден' });

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'amount должен быть положительным числом' });
  }

  const period = validatePeriod(period_start, period_end);
  if (period.error) return res.status(400).json({ error: period.error });

  const paymentMethod = validateMethod(method, type);
  if (paymentMethod.error) return res.status(400).json({ error: paymentMethod.error });

  const result = db
    .prepare(
      `INSERT INTO driver_payments
       (driver_id, type, amount, method, note, period_start, period_end, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      driver_id,
      type,
      numericAmount,
      paymentMethod.method,
      note || null,
      period.start,
      period.end,
      req.user.id
    );

  const row = db.prepare(`${PAYMENT_SELECT} WHERE p.id = ?`).get(result.lastInsertRowid);
  return res.status(201).json(row);
});

router.delete('/payments/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Некорректный id' });
  }
  const exists = db.prepare('SELECT id FROM driver_payments WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Выплата не найдена' });
  db.prepare('DELETE FROM driver_payments WHERE id = ?').run(id);
  return res.json({ ok: true });
});

router.get('/summary', (req, res) => {
  const driverId = req.query.driver_id ? Number(req.query.driver_id) : null;
  const from = req.query.from ? String(req.query.from).slice(0, 10) : null;
  const to = req.query.to ? String(req.query.to).slice(0, 10) : null;

  if (!driverId || !Number.isFinite(driverId)) {
    return res.status(400).json({ error: 'driver_id обязателен' });
  }

  const driver = db.prepare('SELECT id FROM drivers WHERE id = ?').get(driverId);
  if (!driver) return res.status(404).json({ error: 'Водитель не найден' });

  const periodStart = from ?? '1970-01-01';
  const periodEnd = to ?? '2099-12-31';

  const grossTrips = calcDriverTripAccrued(db, driverId, periodStart, periodEnd);
  const compensations = calcDriverCompensations(db, driverId, periodStart, periodEnd);
  const gross = grossTrips + compensations;
  const deducted = calcDriverDeductions(db, driverId, periodStart, periodEnd);

  const payments = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type IN ('salary','advance','bonus') THEN amount END), 0) AS paid
       FROM driver_payments
       WHERE driver_id = ?
         AND date(COALESCE(period_end, created_at)) >= date(?)
         AND date(COALESCE(period_start, created_at)) <= date(?)`
    )
    .get(driverId, periodStart, periodEnd);

  const paid = Number(payments.paid || 0);
  const debt = gross + deducted - paid;

  return res.json({
    driver_id: driverId,
    gross,
    gross_trips: grossTrips,
    compensations,
    paid,
    deducted,
    debt,
  });
});

router.get('/debts', (_req, res) => {
  const drivers = db
    .prepare(
      `SELECT d.id AS driver_id, u.full_name AS driver_name, d.car_number AS driver_car_number
       FROM drivers d
       JOIN users u ON u.id = d.user_id
       ORDER BY u.full_name ASC`
    )
    .all();

  const rows = drivers.map((driver) => {
    const grossTrips = calcDriverTripAccrued(db, driver.driver_id, '1970-01-01', '2099-12-31');
    const compensations = calcDriverCompensations(
      db,
      driver.driver_id,
      '1970-01-01',
      '2099-12-31'
    );
    const gross = grossTrips + compensations;
    const deducted = calcDriverDeductions(db, driver.driver_id, '1970-01-01', '2099-12-31');
    const payments = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN type IN ('salary','advance','bonus') THEN amount END), 0) AS paid
         FROM driver_payments
         WHERE driver_id = ?`
      )
      .get(driver.driver_id);
    const paid = Number(payments.paid || 0);
    const debt = gross + deducted - paid;

    return {
      driver_id: driver.driver_id,
      driver_name: driver.driver_name,
      driver_car_number: driver.driver_car_number,
      gross,
      gross_trips: grossTrips,
      compensations,
      paid,
      deducted,
      debt,
    };
  });

  rows.sort((a, b) => b.debt - a.debt || String(a.driver_name).localeCompare(String(b.driver_name)));
  return res.json(rows);
});

module.exports = router;
