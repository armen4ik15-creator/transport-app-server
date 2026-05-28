const express = require('express');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');

const router = express.Router();
router.use(authMiddleware);

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM materials ORDER BY name').all();
  return res.json(rows);
});

router.post('/', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  const { name, unit, price_per_ton } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name обязателен' });
  }
  const normalizedName = String(name).trim();
  const exists = db.prepare('SELECT id FROM materials WHERE name = ?').get(normalizedName);
  if (exists) return res.status(409).json({ error: 'Материал уже существует' });
  const result = db
    .prepare(
      `INSERT INTO materials (name, unit, price_per_ton, created_by)
       VALUES (?, ?, ?, ?)`
    )
    .run(
      normalizedName,
      unit ? String(unit).trim() : 'т',
      price_per_ton == null || price_per_ton === '' ? null : Number(price_per_ton),
      req.user.id
    );
  logActivity(req.user.id, 'materials.create', { material_id: result.lastInsertRowid });
  const created = db.prepare('SELECT * FROM materials WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Материал не найден' });
  const { name, unit, price_per_ton } = req.body || {};
  db.prepare(
    `UPDATE materials
     SET name = COALESCE(?, name),
         unit = COALESCE(?, unit),
         price_per_ton = COALESCE(?, price_per_ton)
     WHERE id = ?`
  ).run(
    name ? String(name).trim() : null,
    unit ? String(unit).trim() : null,
    price_per_ton == null || price_per_ton === '' ? null : Number(price_per_ton),
    id
  );
  logActivity(req.user.id, 'materials.update', { material_id: id });
  const updated = db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  return res.json(updated);
});

router.delete('/:id', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  const id = Number(req.params.id);
  const current = db.prepare('SELECT id FROM materials WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Материал не найден' });
  db.prepare('DELETE FROM materials WHERE id = ?').run(id);
  logActivity(req.user.id, 'materials.delete', { material_id: id });
  return res.json({ ok: true });
});

module.exports = router;
