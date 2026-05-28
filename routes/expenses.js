const express = require('express');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function getDriverIdForUser(userId) {
  const row = db.prepare('SELECT id, car_number FROM drivers WHERE user_id = ?').get(userId);
  return row || null;
}

const EXPENSE_SELECT = `
  SELECT
    e.id, e.exp_date, e.exp_type, e.method, e.amount, e.comment,
    e.driver_id, e.car_number, e.created_by, e.created_at,
    d.full_name AS driver_name
  FROM expenses e
  LEFT JOIN drivers d ON d.id = e.driver_id
`;

router.get('/', (req, res) => {
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  const requestedDriverId = req.query.driver_id ? Number(req.query.driver_id) : null;

  const where = [];
  const params = [];

  if (from) {
    where.push('date(e.exp_date) >= date(?)');
    params.push(from);
  }
  if (to) {
    where.push('date(e.exp_date) <= date(?)');
    params.push(to);
  }

  if (req.user.role === 'admin') {
    if (requestedDriverId) {
      where.push('e.driver_id = ?');
      params.push(requestedDriverId);
    }
  } else {
    const own = getDriverIdForUser(req.user.id);
    if (!own) return res.json([]);
    where.push('e.driver_id = ?');
    params.push(own.id);
  }

  const rows = db
    .prepare(
      `${EXPENSE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.exp_date DESC, e.id DESC`
    )
    .all(...params);
  return res.json(rows);
});

router.post('/', (req, res) => {
  const { exp_date, exp_type, method, amount, comment, driver_id, car_number } = req.body || {};
  if (amount == null) {
    return res.status(400).json({ error: 'amount обязателен' });
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'amount должен быть положительным числом' });
  }
  if (method && !['cash', 'noncash'].includes(method)) {
    return res.status(400).json({ error: 'method должен быть cash или noncash' });
  }

  let safeDriverId = driver_id ? Number(driver_id) : null;
  let safeCarNumber = car_number ? String(car_number).trim() : null;
  const safeExpDate =
    exp_date && String(exp_date).trim()
      ? String(exp_date).trim()
      : new Date().toISOString().slice(0, 10);
  if (req.user.role !== 'admin') {
    const own = getDriverIdForUser(req.user.id);
    if (!own) {
      return res.status(403).json({ error: 'У водителя не заполнен профиль' });
    }
    safeDriverId = own.id;
    safeCarNumber = own.car_number || safeCarNumber || null;
  }

  if (safeDriverId) {
    const exists = db.prepare('SELECT id FROM drivers WHERE id = ?').get(safeDriverId);
    if (!exists) {
      return res.status(404).json({ error: 'Водитель не найден' });
    }
  }

  const result = db
    .prepare(
      `INSERT INTO expenses
       (exp_date, exp_type, method, amount, comment, driver_id, car_number, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      safeExpDate,
      (exp_type && String(exp_type).trim()) || 'other',
      method || null,
      numericAmount,
      (comment && String(comment).trim()) || null,
      safeDriverId,
      safeCarNumber,
      req.user.id
    );

  const row = db.prepare(`${EXPENSE_SELECT} WHERE e.id = ?`).get(result.lastInsertRowid);
  return res.status(201).json(row);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Некорректный id' });
  }

  const expense = db.prepare('SELECT id, driver_id FROM expenses WHERE id = ?').get(id);
  if (!expense) return res.status(404).json({ error: 'Расход не найден' });

  if (req.user.role !== 'admin') {
    const own = getDriverIdForUser(req.user.id);
    if (!own || Number(expense.driver_id) !== own.id) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
  }

  db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  return res.json({ ok: true });
});

module.exports = router;
