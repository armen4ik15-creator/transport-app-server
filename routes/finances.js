const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function getDriverIdForUser(userId) {
  const row = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(userId);
  return row ? row.id : null;
}

const FINANCE_SELECT = `
  SELECT
    f.id, f.driver_id, f.type, f.amount, f.description, f.order_id, f.created_at,
    d.full_name AS driver_name,
    d.car_number AS driver_car_number
  FROM finances f
  JOIN drivers d ON d.id = f.driver_id
`;

router.get('/', (req, res) => {
  const requestedDriverId = req.query.driver_id ? Number(req.query.driver_id) : null;

  if (req.user.role === 'admin') {
    if (requestedDriverId) {
      const rows = db
        .prepare(`${FINANCE_SELECT} WHERE f.driver_id = ? ORDER BY f.created_at DESC`)
        .all(requestedDriverId);
      return res.json(rows);
    }
    const rows = db.prepare(`${FINANCE_SELECT} ORDER BY f.created_at DESC`).all();
    return res.json(rows);
  }

  const ownDriverId = getDriverIdForUser(req.user.id);
  if (!ownDriverId) return res.json([]);
  const rows = db
    .prepare(`${FINANCE_SELECT} WHERE f.driver_id = ? ORDER BY f.created_at DESC`)
    .all(ownDriverId);
  return res.json(rows);
});

router.post('/', requireRole('admin'), (req, res) => {
  const { driver_id, type, amount, description, order_id } = req.body || {};
  if (!driver_id || !type || amount == null) {
    return res.status(400).json({ error: 'driver_id, type и amount обязательны' });
  }
  if (!['income', 'expense'].includes(type)) {
    return res.status(400).json({ error: 'type должен быть income или expense' });
  }

  const driver = db.prepare('SELECT id FROM drivers WHERE id = ?').get(driver_id);
  if (!driver) return res.status(404).json({ error: 'Водитель не найден' });

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'amount должен быть положительным числом' });
  }

  if (order_id != null) {
    const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(order_id);
    if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  }

  const result = db
    .prepare(
      'INSERT INTO finances (driver_id, type, amount, description, order_id) VALUES (?, ?, ?, ?, ?)'
    )
    .run(driver_id, type, numericAmount, description || null, order_id || null);

  const row = db.prepare(`${FINANCE_SELECT} WHERE f.id = ?`).get(result.lastInsertRowid);
  return res.status(201).json(row);
});

module.exports = router;
