const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { uploadsSubdir } = require('../config/paths');

const router = express.Router();

const UPLOAD_DIR = uploadsSubdir('orders');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `order_${req.params.id}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Разрешены только изображения'));
    }
    cb(null, true);
  },
});

router.use(authMiddleware);

const ORDER_SELECT = `
  SELECT
    o.id, o.driver_id, o.contractor_id, o.task_name, o.sender, o.receiver, o.total_planned_volume,
    o.material, o.quantity, o.unit, o.status, o.notes, o.created_by,
    o.description,
    o.load_address, o.unload_address, o.amount, o.driver_rate, o.company_rate, o.distance_km, o.is_active,
    o.created_at, o.updated_at,
    c.name AS contractor_name,
    u.full_name AS driver_name,
    d.car_number AS driver_car_number
  FROM orders o
  LEFT JOIN contractors c ON c.id = o.contractor_id
  LEFT JOIN drivers d ON d.id = o.driver_id
  LEFT JOIN users u ON u.id = d.user_id
`;

function getDriverIdForUser(userId) {
  const row = db
    .prepare('SELECT id FROM drivers WHERE user_id = ?')
    .get(userId);
  return row ? row.id : null;
}

function ensureOwnerOrAdmin(req, res, order) {
  if (req.user.role === 'admin') return true;
  const driverId = getDriverIdForUser(req.user.id);
  if (order.driver_id !== driverId) {
    res.status(403).json({ error: 'Это не ваш заказ' });
    return false;
  }
  return true;
}

router.get('/', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  if (req.user.role === 'admin') {
    const rows = db
      .prepare(`${ORDER_SELECT} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset);
    return res.json(rows);
  }
  const driverId = getDriverIdForUser(req.user.id);
  if (!driverId) return res.json([]);
  const rows = db
    .prepare(`${ORDER_SELECT} WHERE o.driver_id = ? ORDER BY o.created_at DESC LIMIT ? OFFSET ?`)
    .all(driverId, limit, offset);
  return res.json(rows);
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const order = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  if (!ensureOwnerOrAdmin(req, res, order)) return;
  const photos = db
    .prepare('SELECT * FROM order_photos WHERE order_id = ? ORDER BY uploaded_at')
    .all(id);
  const trips = db
    .prepare(
      `SELECT
         t.id, t.order_id, t.driver_id, t.stage, t.ttn_number, t.volume, t.note, t.photo_path, t.created_by, t.created_at,
         u.email AS created_by_email
       FROM trips t
       JOIN users u ON u.id = t.created_by
       WHERE t.order_id = ?
       ORDER BY t.created_at DESC`
    )
    .all(id);
  return res.json({ ...order, photos, trips });
});

router.post('/', requireRole('admin'), (req, res) => {
  const {
    driver_id,
    contractor_id,
    task_name,
    sender,
    receiver,
    total_planned_volume,
    material,
    quantity,
    notes,
    unit,
    driver_rate,
    company_rate,
    distance_km,
    is_active,
    description,
    load_address,
    unload_address,
    amount,
  } = req.body || {};
  if (!driver_id || !contractor_id) {
    return res
      .status(400)
      .json({ error: 'driver_id и contractor_id обязательны' });
  }
  const driver = db.prepare('SELECT id FROM drivers WHERE id = ?').get(driver_id);
  if (!driver) return res.status(404).json({ error: 'Водитель не найден' });
  const contractor = db
    .prepare('SELECT id FROM contractors WHERE id = ?')
    .get(contractor_id);
  if (!contractor)
    return res.status(404).json({ error: 'Контрагент не найден' });

  const r = db
    .prepare(
      `INSERT INTO orders
       (driver_id, contractor_id, task_name, sender, receiver, total_planned_volume, material, quantity, unit, status, notes, created_by, driver_rate, company_rate, distance_km, is_active, description, load_address, unload_address, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      driver_id,
      contractor_id,
      task_name || null,
      sender || null,
      receiver || null,
      total_planned_volume == null || total_planned_volume === '' ? null : Number(total_planned_volume),
      material || null,
      quantity == null || quantity === '' ? null : Number(quantity),
      unit || null,
      notes || null,
      req.user.id,
      driver_rate == null || driver_rate === '' ? null : Number(driver_rate),
      company_rate == null || company_rate === '' ? null : Number(company_rate),
      distance_km == null || distance_km === '' ? null : Number(distance_km),
      is_active === false || is_active === 0 || is_active === '0' ? 0 : 1,
      description || null,
      load_address || null,
      unload_address || null,
      amount == null || amount === '' ? null : Number(amount)
    );
  const created = db
    .prepare(`${ORDER_SELECT} WHERE o.id = ?`)
    .get(r.lastInsertRowid);
  return res.status(201).json(created);
});

router.post('/bulk', requireRole('admin'), (req, res) => {
  const {
    driver_ids,
    contractor_id,
    task_name,
    sender,
    receiver,
    total_planned_volume,
    material,
    quantity,
    unit,
    notes,
    driver_rate,
    company_rate,
    distance_km,
    description,
    load_address,
    unload_address,
    amount,
    is_active,
  } = req.body || {};
  if (!Array.isArray(driver_ids) || driver_ids.length === 0 || !contractor_id) {
    return res.status(400).json({ error: 'driver_ids и contractor_id обязательны' });
  }
  const contractor = db.prepare('SELECT id FROM contractors WHERE id = ?').get(Number(contractor_id));
  if (!contractor) return res.status(404).json({ error: 'Контрагент не найден' });
  const createdIds = [];
  db.transaction(() => {
    for (const rawDriverId of driver_ids) {
      const driverId = Number(rawDriverId);
      const driver = db.prepare('SELECT id FROM drivers WHERE id = ?').get(driverId);
      if (!driver) continue;
      const result = db
        .prepare(
          `INSERT INTO orders
           (driver_id, contractor_id, task_name, sender, receiver, total_planned_volume, material, quantity, unit, status, notes, created_by, driver_rate, company_rate, distance_km, is_active, description, load_address, unload_address, amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          driverId,
          Number(contractor_id),
          task_name || null,
          sender || null,
          receiver || null,
          total_planned_volume == null || total_planned_volume === '' ? null : Number(total_planned_volume),
          material || null,
          quantity == null || quantity === '' ? null : Number(quantity),
          unit || null,
          notes || null,
          req.user.id,
          driver_rate == null || driver_rate === '' ? null : Number(driver_rate),
          company_rate == null || company_rate === '' ? null : Number(company_rate),
          distance_km == null || distance_km === '' ? null : Number(distance_km),
          is_active === false || is_active === 0 || is_active === '0' ? 0 : 1,
          description || null,
          load_address || null,
          unload_address || null,
          amount == null || amount === '' ? null : Number(amount)
        );
      createdIds.push(result.lastInsertRowid);
    }
  });
  if (createdIds.length === 0) {
    return res.status(400).json({ error: 'Не удалось создать заказы: проверьте driver_ids' });
  }
  const rows = db
    .prepare(`${ORDER_SELECT} WHERE o.id IN (${createdIds.map(() => '?').join(',')}) ORDER BY o.created_at DESC`)
    .all(...createdIds);
  return res.status(201).json(rows);
});

router.put('/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  const allowed = ['pending', 'in_progress', 'completed', 'cancelled'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'status невалиден' });
  }
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  if (!ensureOwnerOrAdmin(req, res, order)) return;

  db.prepare(
    `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(status, id);
  const updated = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id);
  return res.json(updated);
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT id FROM orders WHERE id = ?').get(id);
  if (!current) return res.status(404).json({ error: 'Заказ не найден' });
  const {
    driver_id,
    contractor_id,
    task_name,
    sender,
    receiver,
    total_planned_volume,
    material,
    quantity,
    unit,
    notes,
    driver_rate,
    company_rate,
    distance_km,
    is_active,
    description,
    load_address,
    unload_address,
    amount,
  } = req.body || {};

  db.prepare(
    `UPDATE orders
     SET driver_id = COALESCE(?, driver_id),
         contractor_id = COALESCE(?, contractor_id),
         task_name = COALESCE(?, task_name),
         sender = COALESCE(?, sender),
         receiver = COALESCE(?, receiver),
         total_planned_volume = COALESCE(?, total_planned_volume),
         material = COALESCE(?, material),
         quantity = COALESCE(?, quantity),
         unit = COALESCE(?, unit),
         notes = COALESCE(?, notes),
         driver_rate = COALESCE(?, driver_rate),
         company_rate = COALESCE(?, company_rate),
         distance_km = COALESCE(?, distance_km),
         is_active = COALESCE(?, is_active),
         description = COALESCE(?, description),
         load_address = COALESCE(?, load_address),
         unload_address = COALESCE(?, unload_address),
         amount = COALESCE(?, amount),
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    driver_id == null || driver_id === '' ? null : Number(driver_id),
    contractor_id == null || contractor_id === '' ? null : Number(contractor_id),
    task_name || null,
    sender || null,
    receiver || null,
    total_planned_volume == null || total_planned_volume === '' ? null : Number(total_planned_volume),
    material || null,
    quantity == null || quantity === '' ? null : Number(quantity),
    unit || null,
    notes || null,
    driver_rate == null || driver_rate === '' ? null : Number(driver_rate),
    company_rate == null || company_rate === '' ? null : Number(company_rate),
    distance_km == null || distance_km === '' ? null : Number(distance_km),
    is_active == null ? null : (is_active ? 1 : 0),
    description || null,
    load_address || null,
    unload_address || null,
    amount == null || amount === '' ? null : Number(amount),
    id
  );
  return res.json(db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id));
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const order = db.prepare('SELECT id, is_active FROM orders WHERE id = ?').get(id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  db.prepare('DELETE FROM orders WHERE id = ?').run(id);
  return res.json({ ok: true, message: 'Заказ удалён' });
});

router.post('/:id/photos', upload.single('photo'), (req, res) => {
  const id = Number(req.params.id);
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) {
    fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Заказ не найден' });
  }
  if (!ensureOwnerOrAdmin(req, res, order)) {
    fs.unlink(req.file.path, () => {});
    return;
  }
  const filePath = `/uploads/orders/${req.file.filename}`;
  const r = db
    .prepare('INSERT INTO order_photos (order_id, file_path, uploaded_by) VALUES (?, ?, ?)')
    .run(id, filePath, req.user.id);
  const photo = db
    .prepare('SELECT * FROM order_photos WHERE id = ?')
    .get(r.lastInsertRowid);
  return res.status(201).json(photo);
});

module.exports = router;
