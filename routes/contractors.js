const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, requireRole('admin'));

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM contractors ORDER BY name').all();
  return res.json(rows);
});

router.post('/', (req, res) => {
  const { name, type, phone, address } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name обязателен' });
  }
  if (type && !['company', 'individual', 'gov'].includes(type)) {
    return res.status(400).json({ error: 'type должен быть company, individual или gov' });
  }
  const r = db
    .prepare('INSERT INTO contractors (name, type, phone, address, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(String(name).trim(), type || 'company', phone || null, address || null, req.user.id);
  const created = db
    .prepare('SELECT * FROM contractors WHERE id = ?')
    .get(r.lastInsertRowid);
  return res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, type, phone, address } = req.body || {};
  const exists = db.prepare('SELECT id FROM contractors WHERE id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Контрагент не найден' });
  if (type && !['company', 'individual', 'gov'].includes(type)) {
    return res.status(400).json({ error: 'type должен быть company, individual или gov' });
  }
  db.prepare(
    'UPDATE contractors SET name = COALESCE(?, name), type = COALESCE(?, type), phone = ?, address = ? WHERE id = ?'
  ).run(name ?? null, type ?? null, phone ?? null, address ?? null, id);
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
