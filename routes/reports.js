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
  const requestedDriverId = req.query.driver_id ? Number(req.query.driver_id) : null;

  let driverId = requestedDriverId;
  if (req.user.role !== 'admin') {
    driverId = getDriverIdForUser(req.user.id);
    if (!driverId) {
      return res.json({
        orders_total: 0,
        orders_completed: 0,
        documents_total: 0,
        expenses_total: 0,
        expenses_amount: 0,
        income: 0,
        expense: 0,
        balance: 0,
      });
    }
  }

  const orderWhere = [];
  const orderParams = [];
  if (driverId) {
    orderWhere.push('o.driver_id = ?');
    orderParams.push(driverId);
  }
  if (from) {
    orderWhere.push("date(o.created_at) >= date(?)");
    orderParams.push(from);
  }
  if (to) {
    orderWhere.push("date(o.created_at) <= date(?)");
    orderParams.push(to);
  }

  const orders = db
    .prepare(
      `SELECT
         COUNT(*) AS orders_total,
         COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS orders_completed
       FROM orders o
       ${orderWhere.length ? `WHERE ${orderWhere.join(' AND ')}` : ''}`
    )
    .get(...orderParams);

  const docWhere = [];
  const docParams = [];
  if (driverId) {
    docWhere.push('o.driver_id = ?');
    docParams.push(driverId);
  }
  if (from) {
    docWhere.push("date(d.created_at) >= date(?)");
    docParams.push(from);
  }
  if (to) {
    docWhere.push("date(d.created_at) <= date(?)");
    docParams.push(to);
  }

  const docs = db
    .prepare(
      `SELECT COUNT(*) AS documents_total
       FROM documents d
       JOIN orders o ON o.id = d.order_id
       ${docWhere.length ? `WHERE ${docWhere.join(' AND ')}` : ''}`
    )
    .get(...docParams);

  const finWhere = [];
  const finParams = [];
  if (driverId) {
    finWhere.push('driver_id = ?');
    finParams.push(driverId);
  }
  if (from) {
    finWhere.push("date(created_at) >= date(?)");
    finParams.push(from);
  }
  if (to) {
    finWhere.push("date(created_at) <= date(?)");
    finParams.push(to);
  }

  const finances = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense
       FROM finances
       ${finWhere.length ? `WHERE ${finWhere.join(' AND ')}` : ''}`
    )
    .get(...finParams);

  const expWhere = [];
  const expParams = [];
  if (driverId) {
    expWhere.push('e.driver_id = ?');
    expParams.push(driverId);
  }
  if (from) {
    expWhere.push("date(e.exp_date) >= date(?)");
    expParams.push(from);
  }
  if (to) {
    expWhere.push("date(e.exp_date) <= date(?)");
    expParams.push(to);
  }
  const expenses = db
    .prepare(
      `SELECT
         COUNT(*) AS expenses_total,
         COALESCE(SUM(e.amount), 0) AS expenses_amount
       FROM expenses e
       ${expWhere.length ? `WHERE ${expWhere.join(' AND ')}` : ''}`
    )
    .get(...expParams);

  return res.json({
    orders_total: Number(orders.orders_total || 0),
    orders_completed: Number(orders.orders_completed || 0),
    documents_total: Number(docs.documents_total || 0),
    expenses_total: Number(expenses.expenses_total || 0),
    expenses_amount: Number(expenses.expenses_amount || 0),
    income: Number(finances.income || 0),
    expense: Number(finances.expense || 0),
    balance: Number((finances.income || 0) - (finances.expense || 0)),
  });
});

module.exports = router;
