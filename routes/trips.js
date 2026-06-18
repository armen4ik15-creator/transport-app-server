const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { uploadsSubdir } = require('../config/paths');

const router = express.Router();

const TRIPS_UPLOAD_DIR = uploadsSubdir('trips');

/** Завершённый рейс: новая модель (status) или legacy (stage=unloading). */
const COMPLETED_TRIP_SQL =
  "(t.status = 'completed' OR (t.status IS NULL AND t.stage = 'unloading'))";

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
    t.id, t.order_id, t.driver_id, t.stage, t.status, t.ttn_number, t.volume, t.note,
    t.photo_path, t.created_by, t.created_at, t.completed_at,
    u.email AS created_by_email,
    d.car_number AS driver_car_number,
    du.full_name AS driver_name,
    o.task_name, o.material, o.load_address, o.unload_address, o.driver_rate, o.company_rate,
    o.distance_km, o.unit, o.quantity,
    c.name AS contractor_name
  FROM trips t
  JOIN users u ON u.id = t.created_by
  JOIN drivers d ON d.id = t.driver_id
  LEFT JOIN users du ON du.id = d.user_id
  LEFT JOIN orders o ON o.id = t.order_id
  LEFT JOIN contractors c ON c.id = o.contractor_id
`;

function tryRun(sql) {
  try {
    db.prepare(sql).run();
  } catch (_error) {
    // column may already exist
  }
}

function ensureTripSchema() {
  if (db.kind === 'postgres_error') {
    console.warn('[trips] schema migration skipped (database unavailable)');
    return;
  }
  tryRun('ALTER TABLE trips ADD COLUMN status TEXT');
  tryRun('ALTER TABLE trips ADD COLUMN completed_at TEXT');
  db.prepare(
    `UPDATE trips SET status = 'completed'
     WHERE status IS NULL AND stage = 'unloading'`
  ).run();
  db.prepare(
    `UPDATE trips SET status = 'loading'
     WHERE status IS NULL AND stage = 'loading'`
  ).run();
}

ensureTripSchema();

function getDriverIdForUser(userId) {
  const row = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(userId);
  return row ? row.id : null;
}

function isAllowedForOrder(req, order) {
  if (req.user.role === 'admin') return true;
  const driverId = getDriverIdForUser(req.user.id);
  return driverId !== null && order.driver_id === driverId;
}

function resolveAction(body) {
  const raw = body?.action || body?.stage;
  if (raw === 'loading' || raw === 'unloading') return raw;
  return null;
}

function parseOptionalNumber(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function cleanupUploadedFile(file) {
  if (file) fs.unlink(file.path, () => {});
}

router.get('/', (req, res) => {
  const orderId = req.query.order_id ? Number(req.query.order_id) : null;
  let driverId = req.query.driver_id ? Number(req.query.driver_id) : null;
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  const status = req.query.status ? String(req.query.status) : null;

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
    where.push('date(t.created_at) >= date(?)');
    params.push(from);
  }
  if (to) {
    where.push('date(t.created_at) <= date(?)');
    params.push(to);
  }
  if (status === 'completed') {
    where.push(COMPLETED_TRIP_SQL);
  } else if (status === 'loading') {
    where.push("(t.status = 'loading' OR (t.status IS NULL AND t.stage = 'loading'))");
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);

  const rows = db
    .prepare(
      `${TRIP_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.created_at DESC LIMIT ?`
    )
    .all(...params, limit);

  return res.json(rows);
});

router.get('/summary', (req, res) => {
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  let driverId = req.query.driver_id ? Number(req.query.driver_id) : null;

  if (req.user.role !== 'admin') {
    driverId = getDriverIdForUser(req.user.id);
    if (!driverId) {
      return res.json({ total_trips: 0, total_volume: 0, estimated_income: 0 });
    }
  }

  const where = [COMPLETED_TRIP_SQL];
  const params = [];

  if (driverId) {
    where.push('t.driver_id = ?');
    params.push(driverId);
  }
  if (from) {
    where.push('date(COALESCE(t.completed_at, t.created_at)) >= date(?)');
    params.push(from);
  }
  if (to) {
    where.push('date(COALESCE(t.completed_at, t.created_at)) <= date(?)');
    params.push(to);
  }

  const stats = db
    .prepare(
      `SELECT
         COUNT(*) AS total_trips,
         COALESCE(SUM(t.volume), 0) AS total_volume,
         COALESCE(SUM(COALESCE(o.driver_rate, 0)), 0) AS estimated_income
       FROM trips t
       JOIN orders o ON o.id = t.order_id
       WHERE ${where.join(' AND ')}`
    )
    .get(...params);

  return res.json({
    total_trips: Number(stats.total_trips || 0),
    total_volume: Number(stats.total_volume || 0),
    estimated_income: Number(stats.estimated_income || 0),
  });
});

router.post('/', upload.single('photo'), (req, res) => {
  const action = resolveAction(req.body);
  const { order_id, ttn_number, volume, note } = req.body || {};
  const orderId = Number(order_id);

  if (!Number.isFinite(orderId) || orderId <= 0) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'order_id обязателен' });
  }
  if (!action) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'action должен быть loading или unloading' });
  }

  const order = db.prepare('SELECT id, driver_id FROM orders WHERE id = ?').get(orderId);
  if (!order) {
    cleanupUploadedFile(req.file);
    return res.status(404).json({ error: 'Заказ не найден' });
  }
  if (!isAllowedForOrder(req, order)) {
    cleanupUploadedFile(req.file);
    return res.status(403).json({ error: 'Нет доступа к этому заказу' });
  }

  const tripDriverId =
    req.user.role === 'admin' ? order.driver_id : getDriverIdForUser(req.user.id);

  if (!tripDriverId) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'У водителя не заполнен профиль' });
  }

  const parsedVolume = parseOptionalNumber(volume);
  const trimmedTtn = ttn_number ? String(ttn_number).trim() : null;
  const trimmedNote = note ? String(note).trim() : null;
  const filePath = req.file ? `/uploads/trips/${req.file.filename}` : null;

  if (action === 'loading') {
    const openTrip = db
      .prepare(
        `SELECT id FROM trips
         WHERE order_id = ? AND driver_id = ? AND status = 'loading'
         ORDER BY id DESC LIMIT 1`
      )
      .get(orderId, tripDriverId);

    if (openTrip) {
      cleanupUploadedFile(req.file);
      return res.status(409).json({ error: 'Сначала завершите разгрузку текущего рейса' });
    }

    const result = db
      .prepare(
        `INSERT INTO trips
         (order_id, driver_id, stage, status, ttn_number, volume, note, photo_path, created_by)
         VALUES (?, ?, 'loading', 'loading', ?, ?, ?, ?, ?)`
      )
      .run(
        orderId,
        tripDriverId,
        trimmedTtn,
        parsedVolume,
        trimmedNote,
        filePath,
        req.user.id
      );

    const trip = db.prepare(`${TRIP_SELECT} WHERE t.id = ?`).get(result.lastInsertRowid);
    return res.status(201).json(trip);
  }

  const activeTrip = db
    .prepare(
      `SELECT id, photo_path FROM trips
       WHERE order_id = ? AND driver_id = ? AND status = 'loading'
       ORDER BY id DESC LIMIT 1`
    )
    .get(orderId, tripDriverId);

  if (!activeTrip) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Сначала отметьте погрузку' });
  }

  if (activeTrip.photo_path && filePath) {
    const oldPath = path.join(
      require('../config/paths').UPLOADS_DIR,
      activeTrip.photo_path.replace(/^\/uploads\//, '')
    );
    fs.unlink(oldPath, () => {});
  }

  db.prepare(
    `UPDATE trips
     SET stage = 'unloading',
         status = 'completed',
         ttn_number = COALESCE(?, ttn_number),
         volume = COALESCE(?, volume),
         note = COALESCE(?, note),
         photo_path = COALESCE(?, photo_path),
         completed_at = datetime('now')
     WHERE id = ?`
  ).run(trimmedTtn, parsedVolume, trimmedNote, filePath, activeTrip.id);

  const trip = db.prepare(`${TRIP_SELECT} WHERE t.id = ?`).get(activeTrip.id);
  return res.json(trip);
});

module.exports = router;
module.exports.ensureTripSchema = ensureTripSchema;
