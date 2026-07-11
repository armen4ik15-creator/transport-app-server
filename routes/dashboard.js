const express = require('express');
const db = require('../database');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const RECENT_ORDER_SELECT = `
  SELECT
    o.id, o.driver_id, o.contractor_id, o.task_name, o.material, o.quantity, o.unit,
    o.status, o.load_address, o.unload_address, o.is_active, o.created_at,
    c.name AS contractor_name,
    u.full_name AS driver_name
  FROM orders o
  LEFT JOIN contractors c ON c.id = o.contractor_id
  LEFT JOIN drivers d ON d.id = o.driver_id
  LEFT JOIN users u ON u.id = d.user_id
`;

router.get('/stats', requireRole('admin'), (_req, res) => {
  try {
    const activeOrdersRow = db
      .prepare(`SELECT COUNT(*) AS count FROM orders WHERE is_active = 1`)
      .get();
    const driversOnlineRow = db
      .prepare(`SELECT COUNT(*) AS count FROM drivers WHERE is_active = 1`)
      .get();
    const unreadRow = db
      .prepare(`SELECT COUNT(*) AS count FROM notifications WHERE read = 0`)
      .get();

    let totalDebt = 0;
    try {
      const COMPLETED_TRIP =
        "(t.status = 'completed' OR (t.status IS NULL AND t.stage = 'unloading'))";
      const debtRows = db
        .prepare(
          `SELECT
             COALESCE(tr.accrued, 0) - COALESCE(cp.paid, 0) AS debt
           FROM contractors c
           LEFT JOIN (
             SELECT o.contractor_id,
               SUM(COALESCE(t.volume, 0) * COALESCE(o.company_rate, 0)) AS accrued
             FROM trips t
             JOIN orders o ON o.id = t.order_id
             WHERE ${COMPLETED_TRIP}
             GROUP BY o.contractor_id
           ) tr ON tr.contractor_id = c.id
           LEFT JOIN (
             SELECT contractor_id, COALESCE(SUM(amount), 0) AS paid
             FROM contractor_payments
             GROUP BY contractor_id
           ) cp ON cp.contractor_id = c.id`
        )
        .all();
      totalDebt = debtRows.reduce((sum, row) => sum + Math.max(0, Number(row.debt) || 0), 0);
    } catch (debtError) {
      console.warn('[dashboard] debt aggregation skipped:', debtError.message);
      totalDebt = 0;
    }

    const recentOrders = db
      .prepare(`${RECENT_ORDER_SELECT} ORDER BY o.created_at DESC LIMIT 5`)
      .all();

    return res.json({
      active_orders: Number(activeOrdersRow?.count) || 0,
      drivers_online: Number(driversOnlineRow?.count) || 0,
      unread_notifications: Number(unreadRow?.count) || 0,
      total_debt: totalDebt,
      recent_orders: recentOrders,
    });
  } catch (error) {
    console.error('[dashboard] stats failed:', error.message);
    return res.status(500).json({ error: 'Не удалось загрузить статистику дашборда' });
  }
});

module.exports = router;
