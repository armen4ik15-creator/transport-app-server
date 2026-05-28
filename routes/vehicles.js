const express = require('express');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');

const router = express.Router();
router.use(authMiddleware);

router.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM vehicles ORDER BY plate_number').all();
  return res.json(rows);
});

router.post('/', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  const { plate_number, model, capacity } = req.body || {};
  if (!plate_number || !String(plate_number).trim()) {
    return res.status(400).json({ error: 'plate_number обязателен' });
  }
  const normalizedPlate = String(plate_number).trim().toUpperCase();
  const exists = db.prepare('SELECT id FROM vehicles WHERE plate_number = ?').get(normalizedPlate);
  if (exists) return res.status(409).json({ error: 'Автомобиль с таким номером уже есть' });
  const result = db
    .prepare(
      `INSERT INTO vehicles (plate_number, model, capacity, created_by)
       VALUES (?, ?, ?, ?)`
    )
    .run(
      normalizedPlate,
      model ? String(model).trim() : null,
      capacity == null || capacity === '' ? null : Number(capacity),
      req.user.id
    );
  logActivity(req.user.id, 'vehicles.create', { vehicle_id: result.lastInsertRowid });
  const created = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Автомобиль не найден' });
  const { plate_number, model, capacity } = req.body || {};
  db.prepare(
    `UPDATE vehicles
     SET plate_number = COALESCE(?, plate_number),
         model = COALESCE(?, model),
         capacity = COALESCE(?, capacity)
     WHERE id = ?`
  ).run(
    plate_number ? String(plate_number).trim().toUpperCase() : null,
    model ? String(model).trim() : null,
    capacity == null || capacity === '' ? null : Number(capacity),
    id
  );
  logActivity(req.user.id, 'vehicles.update', { vehicle_id: id });
  const updated = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
  return res.json(updated);
});

router.delete('/:id', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  const id = Number(req.params.id);
  const current = db.prepare('SELECT id FROM vehicles WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Автомобиль не найден' });
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(id);
  logActivity(req.user.id, 'vehicles.delete', { vehicle_id: id });
  return res.json({ ok: true });
});

module.exports = router;
