const express = require('express');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

router.get('/drivers/:id/balance', (req, res) => {
  const driverId = Number(req.params.id);
  const driver = db.prepare('SELECT id, user_id FROM drivers WHERE id = ?').get(driverId);
  if (!driver) return res.status(404).json({ error: 'Водитель не найден' });

  if (req.user.role !== 'admin' && driver.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Доступ запрещён' });
  }

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense
       FROM finances
       WHERE driver_id = ?`
    )
    .get(driverId);

  return res.json({
    driver_id: driverId,
    income: Number(totals.income || 0),
    expense: Number(totals.expense || 0),
    balance: Number((totals.income || 0) - (totals.expense || 0)),
  });
});

module.exports = router;
