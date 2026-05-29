const express = require('express');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function getDriverIdForUser(userId) {
  const row = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(userId);
  return row ? row.id : null;
}

router.get('/summary', (req, res) => {
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  let driverId = req.query.driver_id ? Number(req.query.driver_id) : null;

  if (req.user.role !== 'admin') {
    driverId = getDriverIdForUser(req.user.id);
    if (!driverId) {
      return res.json({
        total_trips: 0,
        total_volume: 0,
        estimated_income: 0,
        actual_income: 0,
        actual_expense: 0,
        actual_balance: 0,
      });
    }
  }

  const tripWhere = ["(t.status = 'completed' OR (t.status IS NULL AND t.stage = 'unloading'))"];
  const tripParams = [];
  if (driverId) {
    tripWhere.push('t.driver_id = ?');
    tripParams.push(driverId);
  }
  if (from) {
    tripWhere.push('date(COALESCE(t.completed_at, t.created_at)) >= date(?)');
    tripParams.push(from);
  }
  if (to) {
    tripWhere.push('date(COALESCE(t.completed_at, t.created_at)) <= date(?)');
    tripParams.push(to);
  }

  const tripStats = db
    .prepare(
      `SELECT
         COUNT(*) AS total_trips,
         COALESCE(SUM(t.volume), 0) AS total_volume,
         COALESCE(SUM(COALESCE(o.driver_rate, 0)), 0) AS estimated_income
       FROM trips t
       JOIN orders o ON o.id = t.order_id
       ${tripWhere.length ? `WHERE ${tripWhere.join(' AND ')}` : ''}`
    )
    .get(...tripParams);

  const financeWhere = [];
  const financeParams = [];
  if (driverId) {
    financeWhere.push('driver_id = ?');
    financeParams.push(driverId);
  }
  if (from) {
    financeWhere.push("date(created_at) >= date(?)");
    financeParams.push(from);
  }
  if (to) {
    financeWhere.push("date(created_at) <= date(?)");
    financeParams.push(to);
  }

  const financeStats = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS actual_income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS actual_expense
       FROM finances
       ${financeWhere.length ? `WHERE ${financeWhere.join(' AND ')}` : ''}`
    )
    .get(...financeParams);

  return res.json({
    total_trips: Number(tripStats.total_trips || 0),
    total_volume: Number(tripStats.total_volume || 0),
    estimated_income: Number(tripStats.estimated_income || 0),
    actual_income: Number(financeStats.actual_income || 0),
    actual_expense: Number(financeStats.actual_expense || 0),
    actual_balance: Number((financeStats.actual_income || 0) - (financeStats.actual_expense || 0)),
  });
});

module.exports = router;
