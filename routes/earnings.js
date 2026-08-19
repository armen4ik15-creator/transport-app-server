const express = require('express');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { COMPLETED_TRIP_SQL } = require('../utils/salaryCalculations');

const router = express.Router();
router.use(authMiddleware);

function getDriverIdForUser(userId) {
  const row = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(userId);
  return row ? row.id : null;
}

function buildExpenseStats(driverId, from, to) {
  const where = ["e.source = 'driver'"];
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

  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN e.status = 'pending' THEN e.amount END), 0) AS expenses_pending,
         COALESCE(SUM(CASE WHEN e.status = 'approved' THEN e.amount END), 0) AS expenses_approved,
         COALESCE(SUM(CASE WHEN e.status = 'rejected' THEN e.amount END), 0) AS expenses_rejected
       FROM expenses e
       WHERE ${where.join(' AND ')}`
    )
    .get(...params);

  const expensesPending = Number(row?.expenses_pending || 0);
  const expensesApproved = Number(row?.expenses_approved || 0);
  const expensesRejected = Number(row?.expenses_rejected || 0);

  return {
    expenses_pending: expensesPending,
    expenses_approved: expensesApproved,
    expenses_rejected: expensesRejected,
    compensations: expensesApproved,
  };
}

function buildTripFilters(driverId, from, to) {
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

  return { where, params };
}

router.get('/summary', async (req, res) => {
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  let driverId = req.query.driver_id ? Number(req.query.driver_id) : null;

  if (req.user.role !== 'admin') {
    driverId = getDriverIdForUser(req.user.id);
    if (!driverId) {
      return res.json({
        total_trips: 0,
        eligible_trips: 0,
        ineligible_trips: 0,
        total_volume: 0,
        estimated_income: 0,
        actual_income: 0,
        actual_expense: 0,
        actual_balance: 0,
        expenses_pending: 0,
        expenses_approved: 0,
        expenses_rejected: 0,
        compensations: 0,
        total_earnings: 0,
        trips: [],
      });
    }
  }

  const { where: tripWhere, params: tripParams } = buildTripFilters(driverId, from, to);

  const tripStats = db
    .prepare(
      `SELECT
         COUNT(*) AS total_trips,
         COALESCE(SUM(t.volume), 0) AS total_volume
       FROM trips t
       JOIN orders o ON o.id = t.order_id
       ${tripWhere.length ? `WHERE ${tripWhere.join(' AND ')}` : ''}`
    )
    .get(...tripParams);

  const tripRows = db
    .prepare(
      `SELECT
         t.id,
         t.order_id,
         t.driver_id,
         t.ttn_number,
         t.volume,
         t.photo_path,
         t.created_at,
         t.completed_at,
         COALESCE(o.driver_rate, 0) AS driver_rate
       FROM trips t
       JOIN orders o ON o.id = t.order_id
       ${tripWhere.length ? `WHERE ${tripWhere.join(' AND ')}` : ''}
       ORDER BY COALESCE(t.completed_at, t.created_at) DESC, t.id DESC`
    )
    .all(...tripParams);

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

  const expenseStats = buildExpenseStats(driverId, from, to);

  const trips = tripRows.map((row) => {
    const photoAvailable = Boolean(row.photo_path && String(row.photo_path).trim());
    const countedInSalary = photoAvailable;
    return {
      id: Number(row.id),
      order_id: Number(row.order_id),
      driver_id: Number(row.driver_id),
      ttn_number: row.ttn_number ?? null,
      volume: row.volume == null ? null : Number(row.volume),
      created_at: row.created_at,
      completed_at: row.completed_at ?? null,
      driver_rate: Number(row.driver_rate || 0),
      photo_path: row.photo_path ?? null,
      has_photos: countedInSalary,
      counted_in_salary: countedInSalary,
      photo_available: photoAvailable,
      salary_payment_status: countedInSalary ? 'unpaid' : 'no_photo',
      salary_shift_label: null,
      salary_shift_debt: countedInSalary ? Number(row.driver_rate || 0) : null,
    };
  });

  const eligibleTrips = trips.filter((trip) => trip.counted_in_salary).length;
  const ineligibleTrips = trips.length - eligibleTrips;
  const estimatedIncome = trips.reduce(
    (sum, trip) => sum + (trip.counted_in_salary ? trip.driver_rate : 0),
    0
  );
  const seniorAllowance = 0;
  const totalEarnings = estimatedIncome + expenseStats.compensations;

  return res.json({
    total_trips: Number(tripStats.total_trips || 0),
    eligible_trips: eligibleTrips,
    ineligible_trips: ineligibleTrips,
    eligible_paid_trips: 0,
    eligible_unpaid_trips: eligibleTrips,
    paid_trip_earnings: 0,
    unpaid_trip_earnings: estimatedIncome,
    total_volume: Number(tripStats.total_volume || 0),
    estimated_income: estimatedIncome,
    senior_allowance: seniorAllowance,
    actual_income: Number(financeStats.actual_income || 0),
    actual_expense: Number(financeStats.actual_expense || 0),
    actual_balance: Number((financeStats.actual_income || 0) - (financeStats.actual_expense || 0)),
    expenses_pending: expenseStats.expenses_pending,
    expenses_approved: expenseStats.expenses_approved,
    expenses_rejected: expenseStats.expenses_rejected,
    compensations: expenseStats.compensations,
    total_earnings: totalEarnings,
    trips,
  });
});

module.exports = router;
