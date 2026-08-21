const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, requireRole('admin'));

const PAYMENT_SELECT = `
  SELECT
    p.id, p.contractor_id, p.amount, p.note, p.payment_date, p.created_by, p.created_at,
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
    .prepare(`${PAYMENT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY COALESCE(p.payment_date, p.created_at) DESC, p.id DESC`)
    .all(...params);
  return res.json(rows);
});

const { findDuplicateImportMarker } = require('../utils/importMarkers');

router.post('/payments', (req, res) => {
  const { contractor_id, amount, note, payment_date } = req.body || {};
  if (!contractor_id || amount == null) {
    return res.status(400).json({ error: 'contractor_id и amount обязательны' });
  }

  const contractor = db.prepare('SELECT id FROM contractors WHERE id = ?').get(contractor_id);
  if (!contractor) return res.status(404).json({ error: 'Контрагент не найден' });

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'amount должен быть положительным числом' });
  }

  const duplicate = findDuplicateImportMarker(db, 'contractor_payments', note, {
    amount: numericAmount,
  });
  if (duplicate) {
    return res.status(409).json({
      error: `Дубликат импорта: маркер ${duplicate.marker} уже в оплате #${duplicate.id}`,
      existing_id: duplicate.id,
      marker: duplicate.marker,
    });
  }

  const safePaymentDate =
    payment_date && String(payment_date).trim()
      ? String(payment_date).trim()
      : new Date().toISOString().slice(0, 10);

  const result = db
    .prepare(
      `INSERT INTO contractor_payments
       (contractor_id, amount, note, payment_date, created_by)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(contractor_id, numericAmount, note || null, safePaymentDate, req.user.id);

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

const COMPLETED_TRIP =
  "(t.status = 'completed' OR (t.status IS NULL AND t.stage = 'unloading'))";

/**
 * Долг = входящее сальдо + навезли после даты сальдо − оплаты после даты сальдо.
 * Если даты сальдо нет — учитываются все рейсы и оплаты (как раньше, плюс opening_balance).
 */
const DEBT_SUMMARY_SQL = `
  SELECT
    c.id AS contractor_id,
    c.name AS contractor_name,
    COALESCE(c.opening_balance, 0) AS opening_balance,
    c.opening_balance_date,
    COALESCE(tr.accrued, 0) AS accrued,
    COALESCE(cp.paid, 0) AS paid,
    COALESCE(c.opening_balance, 0) + COALESCE(tr.accrued, 0) - COALESCE(cp.paid, 0) AS debt
  FROM contractors c
  LEFT JOIN (
    SELECT
      o.contractor_id,
      SUM(COALESCE(t.volume, 0) * COALESCE(o.company_rate, 0)) AS accrued
    FROM trips t
    JOIN orders o ON o.id = t.order_id
    JOIN contractors c2 ON c2.id = o.contractor_id
    WHERE ${COMPLETED_TRIP}
      AND (
        c2.opening_balance_date IS NULL
        OR SUBSTR(COALESCE(t.completed_at, t.created_at), 1, 10) >= c2.opening_balance_date
      )
    GROUP BY o.contractor_id
  ) tr ON tr.contractor_id = c.id
  LEFT JOIN (
    SELECT
      p.contractor_id,
      COALESCE(SUM(p.amount), 0) AS paid
    FROM contractor_payments p
    JOIN contractors c3 ON c3.id = p.contractor_id
    WHERE
      c3.opening_balance_date IS NULL
      OR SUBSTR(COALESCE(p.payment_date, p.created_at), 1, 10) >= c3.opening_balance_date
    GROUP BY p.contractor_id
  ) cp ON cp.contractor_id = c.id
  ORDER BY debt DESC, c.name ASC
`;

router.get('/summary', (_req, res) => {
  const rows = db.prepare(DEBT_SUMMARY_SQL).all();
  return res.json(rows);
});

module.exports = router;
module.exports.DEBT_SUMMARY_SQL = DEBT_SUMMARY_SQL;
