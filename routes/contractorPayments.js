const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, requireRole('admin'));

const PAYMENT_SELECT = `
  SELECT
    p.id, p.contractor_id, p.amount, p.note, p.created_by, p.created_at,
    c.name AS contractor_name
  FROM contractor_payments p
  JOIN contractors c ON c.id = p.contractor_id
`;

router.get('/payments', (req, res) => {
  const contractorId = req.query.contractor_id ? Number(req.query.contractor_id) : null;
  const where = [];
  const params = [];
  if (contractorId) {
    where.push('p.contractor_id = ?');
    params.push(contractorId);
  }
  const rows = db
    .prepare(`${PAYMENT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.created_at DESC`)
    .all(...params);
  return res.json(rows);
});

router.post('/payments', (req, res) => {
  const { contractor_id, amount, note } = req.body || {};
  if (!contractor_id || amount == null) {
    return res.status(400).json({ error: 'contractor_id и amount обязательны' });
  }

  const contractor = db.prepare('SELECT id FROM contractors WHERE id = ?').get(contractor_id);
  if (!contractor) return res.status(404).json({ error: 'Контрагент не найден' });

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'amount должен быть положительным числом' });
  }

  const result = db
    .prepare(
      `INSERT INTO contractor_payments
       (contractor_id, amount, note, created_by)
       VALUES (?, ?, ?, ?)`
    )
    .run(contractor_id, numericAmount, note || null, req.user.id);

  const row = db.prepare(`${PAYMENT_SELECT} WHERE p.id = ?`).get(result.lastInsertRowid);
  return res.status(201).json(row);
});

router.delete('/payments/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Некорректный id' });
  }
  const exists = db.prepare('SELECT id FROM contractor_payments WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Оплата не найдена' });
  db.prepare('DELETE FROM contractor_payments WHERE id = ?').run(id);
  return res.json({ ok: true });
});

router.get('/summary', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT
         c.id AS contractor_id,
         c.name AS contractor_name,
         COALESCE(SUM(CASE WHEN o.status = 'completed' THEN COALESCE(o.amount, 0) END), 0) AS accrued,
         COALESCE(cp.paid, 0) AS paid,
         COALESCE(SUM(CASE WHEN o.status = 'completed' THEN COALESCE(o.amount, 0) END), 0) - COALESCE(cp.paid, 0) AS debt
       FROM contractors c
       LEFT JOIN orders o ON o.contractor_id = c.id
       LEFT JOIN (
         SELECT contractor_id, COALESCE(SUM(amount), 0) AS paid
         FROM contractor_payments
         GROUP BY contractor_id
       ) cp ON cp.contractor_id = c.id
       GROUP BY c.id, c.name, cp.paid
       ORDER BY debt DESC, c.name ASC`
    )
    .all();

  return res.json(rows);
});

module.exports = router;
