const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
    o.id, o.driver_id, o.contractor_id, o.material, o.quantity, o.status, o.notes, o.created_by,
    o.description,
    o.load_address, o.unload_address, o.amount,
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
  if (req.user.role === 'admin') {
    const rows = db.prepare(`${ORDER_SELECT} ORDER BY o.created_at DESC`).all();
    return res.json(rows);
  }
  const driverId = getDriverIdForUser(req.user.id);
  if (!driverId) return res.json([]);
  const rows = db
    .prepare(`${ORDER_SELECT} WHERE o.driver_id = ? ORDER BY o.created_at DESC`)
    .all(driverId);
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
  return res.json({ ...order, photos });
});

router.post('/', requireRole('admin'), (req, res) => {
  const {
    driver_id,
    contractor_id,
    material,
    quantity,
    notes,
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
       (driver_id, contractor_id, material, quantity, status, notes, created_by, description, load_address, unload_address, amount)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      driver_id,
      contractor_id,
      material || null,
      quantity == null || quantity === '' ? null : Number(quantity),
      notes || null,
      req.user.id,
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
  const filePath = `/uploads/${req.file.filename}`;
  const r = db
    .prepare('INSERT INTO order_photos (order_id, file_path, uploaded_by) VALUES (?, ?, ?)')
    .run(id, filePath, req.user.id);
  const photo = db
    .prepare('SELECT * FROM order_photos WHERE id = ?')
    .get(r.lastInsertRowid);
  return res.status(201).json(photo);
});

module.exports = router;
