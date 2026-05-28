const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, requireRole('admin'));

const PAYMENT_SELECT = `
  SELECT
    p.id, p.driver_id, p.type, p.amount, p.note, p.created_by, p.created_at,
    u.full_name AS driver_name,
    d.car_number AS driver_car_number
  FROM driver_payments p
  JOIN drivers d ON d.id = p.driver_id
  JOIN users u ON u.id = d.user_id
`;

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

router.post('/payments', (req, res) => {
  const { driver_id, type, amount, note } = req.body || {};
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

  const result = db
    .prepare(
      `INSERT INTO driver_payments
       (driver_id, type, amount, note, created_by)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(driver_id, type, numericAmount, note || null, req.user.id);

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

  if (!driverId || !Number.isFinite(driverId)) {
    return res.status(400).json({ error: 'driver_id обязателен' });
  }

  const driver = db.prepare('SELECT id FROM drivers WHERE id = ?').get(driverId);
  if (!driver) return res.status(404).json({ error: 'Водитель не найден' });

  const incomeExpense = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense
       FROM finances
       WHERE driver_id = ?`
    )
    .get(driverId);

  const payments = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type IN ('salary','advance','bonus') THEN amount END), 0) AS paid,
         COALESCE(SUM(CASE WHEN type = 'deduction' THEN amount END), 0) AS deducted
       FROM driver_payments
       WHERE driver_id = ?`
    )
    .get(driverId);

  const gross = Number(incomeExpense.income || 0) - Number(incomeExpense.expense || 0);
  const paid = Number(payments.paid || 0);
  const deducted = Number(payments.deducted || 0);
  const debt = gross + deducted - paid;

  return res.json({
    driver_id: driverId,
    gross,
    paid,
    deducted,
    debt,
  });
});

router.get('/debts', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT
         d.id AS driver_id,
         u.full_name AS driver_name,
         d.car_number AS driver_car_number,
         COALESCE(fin.income, 0) - COALESCE(fin.expense, 0) AS gross,
         COALESCE(pay.paid, 0) AS paid,
         COALESCE(pay.deducted, 0) AS deducted,
         (COALESCE(fin.income, 0) - COALESCE(fin.expense, 0)) + COALESCE(pay.deducted, 0) - COALESCE(pay.paid, 0) AS debt
       FROM drivers d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN (
         SELECT
           driver_id,
           COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense
         FROM finances
         GROUP BY driver_id
       ) fin ON fin.driver_id = d.id
       LEFT JOIN (
         SELECT
           driver_id,
           COALESCE(SUM(CASE WHEN type IN ('salary','advance','bonus') THEN amount END), 0) AS paid,
           COALESCE(SUM(CASE WHEN type = 'deduction' THEN amount END), 0) AS deducted
         FROM driver_payments
         GROUP BY driver_id
       ) pay ON pay.driver_id = d.id
       ORDER BY debt DESC, u.full_name ASC`
    )
    .all();
  return res.json(rows);
});

module.exports = router;
