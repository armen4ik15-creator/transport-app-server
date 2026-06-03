const express = require('express');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const COMPLETED_TRIP_SQL =
  "(t.status = 'completed' OR (t.status IS NULL AND t.stage = 'unloading'))";

function getDriverIdForUser(userId) {
  const row = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(userId);
  return row ? row.id : null;
}

function resolveDriverId(req) {
  const requested = req.query.driver_id ? Number(req.query.driver_id) : null;
  if (req.user.role !== 'admin') {
    return getDriverIdForUser(req.user.id);
  }
  return Number.isFinite(requested) && requested > 0 ? requested : null;
}

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function listDatesInclusive(from, to) {
  if (!from || !to) return [];
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return [];
  }
  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function fetchTripDaily({ from, to, driverId }) {
  const where = [COMPLETED_TRIP_SQL];
  const params = [];
  if (driverId) {
    where.push('t.driver_id = ?');
    params.push(driverId);
  }
  if (from) {
    where.push('date(COALESCE(t.completed_at, t.created_at)) >= date(?)');
    params.push(from);
  }
  if (to) {
    where.push('date(COALESCE(t.completed_at, t.created_at)) <= date(?)');
    params.push(to);
  }

  return db
    .prepare(
      `SELECT
         date(COALESCE(t.completed_at, t.created_at)) AS day,
         COUNT(*) AS trips_count,
         COALESCE(SUM(COALESCE(t.volume, 0) * o.company_rate), 0) AS revenue,
         COALESCE(SUM(o.driver_rate), 0) AS driver_pay
       FROM trips t
       JOIN orders o ON o.id = t.order_id
       WHERE ${where.join(' AND ')}
       GROUP BY day`
    )
    .all(...params);
}

function fetchExpenseDaily({ from, to, driverId }) {
  const where = [];
  const params = [];
  if (driverId) {
    where.push('e.driver_id = ?');
    params.push(driverId);
  }
  if (from) {
    where.push('date(e.exp_date) >= date(?)');
    params.push(from);
  }
  if (to) {
    where.push('date(e.exp_date) <= date(?)');
    params.push(to);
  }

  return db
    .prepare(
      `SELECT
         date(e.exp_date) AS day,
         COUNT(*) AS expenses_count,
         COALESCE(SUM(e.amount), 0) AS expenses
       FROM expenses e
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       GROUP BY day`
    )
    .all(...params);
}

function buildDailyRows({ from, to, driverId }) {
  const tripByDay = new Map();
  fetchTripDaily({ from, to, driverId }).forEach((row) => {
    tripByDay.set(String(row.day), {
      trips_count: asNumber(row.trips_count),
      revenue: asNumber(row.revenue),
      driver_pay: asNumber(row.driver_pay),
    });
  });

  const expenseByDay = new Map();
  fetchExpenseDaily({ from, to, driverId }).forEach((row) => {
    expenseByDay.set(String(row.day), {
      expenses_count: asNumber(row.expenses_count),
      expenses: asNumber(row.expenses),
    });
  });

  const dateKeys = new Set([...tripByDay.keys(), ...expenseByDay.keys()]);
  if (from && to) {
    listDatesInclusive(from, to).forEach((d) => dateKeys.add(d));
  }

  const days = [...dateKeys]
    .sort((a, b) => b.localeCompare(a))
    .map((date) => {
      const trip = tripByDay.get(date) ?? { trips_count: 0, revenue: 0, driver_pay: 0 };
      const exp = expenseByDay.get(date) ?? { expenses_count: 0, expenses: 0 };
      const costs = trip.driver_pay + exp.expenses;
      const profit = trip.revenue - costs;
      return {
        date,
        trips_count: trip.trips_count,
        revenue: trip.revenue,
        driver_pay: trip.driver_pay,
        expenses: exp.expenses,
        expenses_count: exp.expenses_count,
        costs,
        profit,
      };
    });

  const totals = days.reduce(
    (acc, day) => ({
      trips_count: acc.trips_count + day.trips_count,
      revenue: acc.revenue + day.revenue,
      driver_pay: acc.driver_pay + day.driver_pay,
      expenses: acc.expenses + day.expenses,
      costs: acc.costs + day.costs,
      profit: acc.profit + day.profit,
    }),
    { trips_count: 0, revenue: 0, driver_pay: 0, expenses: 0, costs: 0, profit: 0 }
  );

  return { days, totals };
}

router.get('/daily', (req, res) => {
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  const driverId = resolveDriverId(req);

  if (req.user.role !== 'admin' && !driverId) {
    return res.json({ days: [], totals: { trips_count: 0, revenue: 0, driver_pay: 0, expenses: 0, costs: 0, profit: 0 } });
  }

  if (!from || !to) {
    return res.status(400).json({ error: 'Укажите период from и to (YYYY-MM-DD)' });
  }

  return res.json(buildDailyRows({ from, to, driverId }));
});

router.get('/summary', (req, res) => {
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  const driverId = resolveDriverId(req);

  if (req.user.role !== 'admin' && !driverId) {
    return res.json({
      orders_total: 0,
      orders_completed: 0,
      documents_total: 0,
      expenses_total: 0,
      expenses_amount: 0,
      income: 0,
      expense: 0,
      balance: 0,
      trips_count: 0,
      revenue: 0,
      driver_pay: 0,
      profit: 0,
    });
  }

  const { totals } = from && to ? buildDailyRows({ from, to, driverId }) : { totals: null };

  const orderWhere = [];
  const orderParams = [];
  if (driverId) {
    orderWhere.push('o.driver_id = ?');
    orderParams.push(driverId);
  }
  if (from) {
    orderWhere.push('date(o.created_at) >= date(?)');
    orderParams.push(from);
  }
  if (to) {
    orderWhere.push('date(o.created_at) <= date(?)');
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
    docWhere.push('date(d.created_at) >= date(?)');
    docParams.push(from);
  }
  if (to) {
    docWhere.push('date(d.created_at) <= date(?)');
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

  const tripTotals = totals ?? {
    trips_count: 0,
    revenue: 0,
    driver_pay: 0,
    expenses: 0,
    costs: 0,
    profit: 0,
  };

  return res.json({
    orders_total: Number(orders.orders_total || 0),
    orders_completed: Number(orders.orders_completed || 0),
    documents_total: Number(docs.documents_total || 0),
    expenses_total: Number(tripTotals.expenses > 0 ? tripTotals.expenses : 0),
    expenses_amount: Number(tripTotals.expenses || 0),
    income: Number(tripTotals.revenue || 0),
    expense: Number(tripTotals.costs || 0),
    balance: Number(tripTotals.profit || 0),
    trips_count: Number(tripTotals.trips_count || 0),
    revenue: Number(tripTotals.revenue || 0),
    driver_pay: Number(tripTotals.driver_pay || 0),
    profit: Number(tripTotals.profit || 0),
  });
});

module.exports = router;
