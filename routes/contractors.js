const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, requireRole('admin'));

function parseOpeningBalance(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return { error: 'opening_balance должен быть числом' };
  }
  return { value: numeric };
}

function parseOpeningBalanceDate(value) {
  if (value == null || value === '') return { value: null };
  const date = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'opening_balance_date должен быть в формате YYYY-MM-DD' };
  }
  return { value: date };
}

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM contractors ORDER BY name').all();
  return res.json(rows);
});

router.post('/', (req, res) => {
  const { name, type, phone, address, opening_balance, opening_balance_date } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name обязателен' });
  }
  if (type && !['company', 'individual', 'gov'].includes(type)) {
    return res.status(400).json({ error: 'type должен быть company, individual или gov' });
  }

  const balance = parseOpeningBalance(opening_balance ?? 0);
  if (balance.error) return res.status(400).json({ error: balance.error });
  const balanceDate = parseOpeningBalanceDate(opening_balance_date);
  if (balanceDate.error) return res.status(400).json({ error: balanceDate.error });

  const r = db
    .prepare(
      `INSERT INTO contractors
       (name, type, phone, address, opening_balance, opening_balance_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(name).trim(),
      type || 'company',
      phone || null,
      address || null,
      balance.value ?? 0,
      balanceDate.value,
      req.user.id
    );
  const created = db.prepare('SELECT * FROM contractors WHERE id = ?').get(r.lastInsertRowid);
  return res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, type, phone, address, opening_balance, opening_balance_date } = req.body || {};
  const exists = db.prepare('SELECT id FROM contractors WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Контрагент не найден' });
  if (type && !['company', 'individual', 'gov'].includes(type)) {
    return res.status(400).json({ error: 'type должен быть company, individual или gov' });
  }

  const current = db.prepare('SELECT * FROM contractors WHERE id = ?').get(id);
  let nextBalance = current.opening_balance ?? 0;
  let nextBalanceDate = current.opening_balance_date ?? null;

  if (opening_balance !== undefined) {
    const balance = parseOpeningBalance(opening_balance);
    if (balance.error) return res.status(400).json({ error: balance.error });
    nextBalance = balance.value ?? 0;
  }
  if (opening_balance_date !== undefined) {
    const balanceDate = parseOpeningBalanceDate(opening_balance_date);
    if (balanceDate.error) return res.status(400).json({ error: balanceDate.error });
    nextBalanceDate = balanceDate.value;
  }

  db.prepare(
    `UPDATE contractors
     SET name = COALESCE(?, name),
         type = COALESCE(?, type),
         phone = CASE WHEN ? THEN ? ELSE phone END,
         address = CASE WHEN ? THEN ? ELSE address END,
         opening_balance = ?,
         opening_balance_date = ?
     WHERE id = ?`
  ).run(
    name ?? null,
    type ?? null,
    phone !== undefined ? 1 : 0,
    phone ?? null,
    address !== undefined ? 1 : 0,
    address ?? null,
    nextBalance,
    nextBalanceDate,
    id
  );
  return res.json(db.prepare('SELECT * FROM contractors WHERE id = ?').get(id));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const exists = db.prepare('SELECT id FROM contractors WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Контрагент не найден' });
  db.prepare('DELETE FROM contractors WHERE id = ?').run(id);
  return res.json({ ok: true });
});

module.exports = router;
