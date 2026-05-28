const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const TRIPS_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'trips');
if (!fs.existsSync(TRIPS_UPLOAD_DIR)) fs.mkdirSync(TRIPS_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TRIPS_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `trip_${Date.now()}${ext}`);
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

const TRIP_SELECT = `
  SELECT
    t.id, t.order_id, t.driver_id, t.stage, t.ttn_number, t.volume, t.note, t.photo_path, t.created_by, t.created_at,
    u.email AS created_by_email,
    d.car_number AS driver_car_number,
    du.full_name AS driver_name
  FROM trips t
  JOIN users u ON u.id = t.created_by
  JOIN drivers d ON d.id = t.driver_id
  LEFT JOIN users du ON du.id = d.user_id
`;

function getDriverIdForUser(userId) {
  const row = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(userId);
  return row ? row.id : null;
}

function isAllowedForOrder(req, order) {
  if (req.user.role === 'admin') return true;
  const driverId = getDriverIdForUser(req.user.id);
  return driverId !== null && order.driver_id === driverId;
}

router.get('/', (req, res) => {
  const orderId = req.query.order_id ? Number(req.query.order_id) : null;
  let driverId = req.query.driver_id ? Number(req.query.driver_id) : null;
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;

  if (req.user.role !== 'admin') {
    driverId = getDriverIdForUser(req.user.id);
    if (!driverId) return res.json([]);
  }

  const where = [];
  const params = [];

  if (orderId) {
    where.push('t.order_id = ?');
    params.push(orderId);
  }
  if (driverId) {
    where.push('t.driver_id = ?');
    params.push(driverId);
  }
  if (from) {
    where.push("date(t.created_at) >= date(?)");
    params.push(from);
  }
  if (to) {
    where.push("date(t.created_at) <= date(?)");
    params.push(to);
  }

  const rows = db
    .prepare(`${TRIP_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.created_at DESC`)
    .all(...params);

  return res.json(rows);
});

router.post('/', upload.single('photo'), (req, res) => {
  const { order_id, stage, ttn_number, volume, note } = req.body || {};
  const orderId = Number(order_id);

  if (!Number.isFinite(orderId) || orderId <= 0) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'order_id обязателен' });
  }
  if (!['loading', 'unloading'].includes(stage)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'stage должен быть loading или unloading' });
  }

  const order = db.prepare('SELECT id, driver_id FROM orders WHERE id = ?').get(orderId);
  if (!order) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Заказ не найден' });
  }
  if (!isAllowedForOrder(req, order)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: 'Нет доступа к этому заказу' });
  }

  const filePath = req.file ? `/uploads/trips/${req.file.filename}` : null;
  const tripDriverId =
    req.user.role === 'admin'
      ? order.driver_id
      : getDriverIdForUser(req.user.id);

  if (!tripDriverId) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'У водителя не заполнен профиль' });
  }

  const result = db
    .prepare(
      `INSERT INTO trips
       (order_id, driver_id, stage, ttn_number, volume, note, photo_path, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      orderId,
      tripDriverId,
      stage,
      ttn_number ? String(ttn_number).trim() : null,
      volume == null || volume === '' ? null : Number(volume),
      note ? String(note).trim() : null,
      filePath,
      req.user.id
    );

  const trip = db.prepare(`${TRIP_SELECT} WHERE t.id = ?`).get(result.lastInsertRowid);
  return res.status(201).json(trip);
});

module.exports = router;
