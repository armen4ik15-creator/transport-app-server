const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { UPLOADS_DIR, uploadsSubdir } = require('../config/paths');
const { isUploadFileAvailable } = require('../utils/uploadPaths');
const { deleteStoredUpload, isUploadAvailable } = require('../utils/uploadsStorage');
const { persistUploadMirror } = require('../utils/uploadPersistence');

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
    const mime = String(file.mimetype || '').toLowerCase();
    if (!mime || mime.startsWith('image/') || mime === 'application/octet-stream') {
      return cb(null, true);
    }
    return cb(new Error('Разрешены только изображения (JPG, PNG)'));
  },
});

function handlePhotoUpload(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (!err) return next();
    console.warn('[trips][photo][multer]', err.message || err);
    if (req.file) cleanupUploadedFile(req.file);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Файл слишком большой (максимум 10 МБ)' });
    }
    return res.status(400).json({
      error: err.message || 'Не удалось загрузить файл',
    });
  });
}

function isTripCompletedRow(trip) {
  return trip.status === 'completed' || trip.stage === 'unloading';
}

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

function unlinkStoredUpload(filePath) {
  if (!filePath) return;
  const relative = String(filePath).replace(/^\/uploads\//, '');
  if (relative.includes('..')) return;
  const absolute = path.join(UPLOADS_DIR, relative);
  try {
    if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
  } catch {
    // ignore file cleanup errors
  }
}

async function removeStoredUpload(filePath) {
  if (!filePath) return;
  await deleteStoredUpload(filePath);
}

function isTripLoading(trip) {
  return trip.status === 'loading' || (trip.status == null && trip.stage === 'loading');
}

function findDuplicateTtn(ttnNumber, excludeTripId = null) {
  const normalized = ttnNumber ? String(ttnNumber).trim() : '';
  if (!normalized) return null;

  const params = [normalized];
  let excludeSql = '';
  if (excludeTripId != null) {
    excludeSql = ' AND id != ?';
    params.push(excludeTripId);
  }

  return db
    .prepare(
      `SELECT id FROM trips
       WHERE ttn_number IS NOT NULL
         AND TRIM(ttn_number) != ''
         AND ttn_number = ?
         ${excludeSql}
       LIMIT 1`
    )
    .get(...params);
}

function deleteTripPhotoFiles(trip) {
  if (trip.photo_path) {
    void deleteStoredUpload(trip.photo_path).catch((error) => {
      console.warn('[trips] photo delete failed:', error.message);
    });
  }
}

function enrichTripRow(row) {
  if (!row) return row;
  const photoPath = row.photo_path ? String(row.photo_path).trim() : '';
  const photoAvailable = photoPath ? isUploadFileAvailable(photoPath) : false;
  return { ...row, photo_available: photoAvailable };
}

async function enrichTripRowAsync(row) {
  if (!row) return row;
  const photoPath = row.photo_path ? String(row.photo_path).trim() : '';
  if (!photoPath) return { ...row, photo_available: false };
  const photoAvailable = await isUploadAvailable(photoPath);
  return { ...row, photo_available: photoAvailable };
}

async function mapTripsWithPhotoAvailability(rows, concurrency = 6) {
  const { mapWithConcurrency } = require('../utils/mapWithConcurrency');
  return mapWithConcurrency(rows, (row) => enrichTripRowAsync(row), concurrency);
}

function extensionFromMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  return '.jpg';
}

function validateTripPhotoAccess(req, res, id, trip) {
  if (!trip) {
    return { error: { status: 404, message: 'Рейс не найден' } };
  }

  const order = db.prepare('SELECT id, driver_id FROM orders WHERE id = ?').get(trip.order_id);
  if (!order || !isAllowedForOrder(req, order)) {
    return { error: { status: 403, message: 'Нет доступа к этому рейсу' } };
  }

  if (req.user.role !== 'admin') {
    const driverId = getDriverIdForUser(req.user.id);
    if (!driverId || Number(trip.driver_id) !== driverId) {
      return { error: { status: 403, message: 'Недостаточно прав' } };
    }
  }

  if (!isTripCompletedRow(trip)) {
    return { error: { status: 400, message: 'Фото можно прикрепить только к завершённому рейсу' } };
  }

  return { order };
}

function validateTripPhotoDeleteAccess(req, trip) {
  if (!trip) {
    return { error: { status: 404, message: 'Рейс не найден' } };
  }

  const order = db.prepare('SELECT id, driver_id FROM orders WHERE id = ?').get(trip.order_id);
  if (!order || !isAllowedForOrder(req, order)) {
    return { error: { status: 403, message: 'Нет доступа к этому рейсу' } };
  }

  if (req.user.role !== 'admin') {
    const driverId = getDriverIdForUser(req.user.id);
    if (!driverId || Number(trip.driver_id) !== driverId) {
      return { error: { status: 403, message: 'Недостаточно прав' } };
    }
  }

  return { ok: true };
}

async function persistTripPhoto(req, res, id, buffer, mimeType) {
  const trip = db
    .prepare('SELECT id, order_id, driver_id, status, stage, photo_path FROM trips WHERE id = ?')
    .get(id);

  const access = validateTripPhotoAccess(req, res, id, trip);
  if (access.error) {
    return res.status(access.error.status).json({ error: access.error.message });
  }

  if (trip.photo_path) {
    await removeStoredUpload(trip.photo_path);
  }

  const ext = extensionFromMime(mimeType);
  const filename = `trip_${Date.now()}${ext}`;
  const absolutePath = path.join(TRIPS_UPLOAD_DIR, filename);
  fs.writeFileSync(absolutePath, buffer);

  const filePath = `/uploads/trips/${filename}`;
  db.prepare('UPDATE trips SET photo_path = ? WHERE id = ?').run(filePath, id);

  try {
    await persistUploadMirror(filePath, { buffer, mimeType });
  } catch (error) {
    db.prepare('UPDATE trips SET photo_path = NULL WHERE id = ?').run(id);
    unlinkStoredUpload(filePath);
    return res.status(503).json({ error: error.message });
  }

  const updatedTrip = db.prepare(`${TRIP_SELECT} WHERE t.id = ?`).get(id);
  const enriched = await enrichTripRowAsync(updatedTrip);
  return res.json(enriched);
}

router.get('/', async (req, res) => {
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

  const enriched = await mapTripsWithPhotoAvailability(rows);
  return res.json(enriched);
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

router.post('/', (req, res, next) => {
  const contentType = String(req.headers['content-type'] || '');
  if (contentType.includes('multipart/form-data')) {
    return handlePhotoUpload(req, res, next);
  }
  next();
}, async (req, res) => {
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

    if (trimmedTtn) {
      const duplicate = findDuplicateTtn(trimmedTtn);
      if (duplicate) {
        cleanupUploadedFile(req.file);
        return res.status(409).json({ error: 'Номер ТТН уже использован' });
      }
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
    if (filePath) {
      let buffer = null;
      if (req.file?.path && fs.existsSync(req.file.path)) {
        buffer = fs.readFileSync(req.file.path);
      }
      try {
        await persistUploadMirror(filePath, {
          buffer,
          mimeType: req.file?.mimetype || 'image/jpeg',
        });
      } catch (error) {
        db.prepare('UPDATE trips SET photo_path = NULL WHERE id = ?').run(trip.id);
        unlinkStoredUpload(filePath);
        return res.status(503).json({ error: error.message });
      }
    }
    const enriched = await enrichTripRowAsync(trip);
    return res.status(201).json(enriched);
  }

  const activeTrip = db
    .prepare(
      `SELECT id, photo_path, ttn_number FROM trips
       WHERE order_id = ? AND driver_id = ? AND status = 'loading'
       ORDER BY id DESC LIMIT 1`
    )
    .get(orderId, tripDriverId);

  if (!activeTrip) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Сначала отметьте погрузку' });
  }

  const finalTtn = trimmedTtn || (activeTrip.ttn_number ? String(activeTrip.ttn_number).trim() : null);
  if (finalTtn) {
    const duplicate = findDuplicateTtn(finalTtn, activeTrip.id);
    if (duplicate) {
      cleanupUploadedFile(req.file);
      return res.status(409).json({ error: 'Номер ТТН уже использован' });
    }
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
  if (filePath) {
    let buffer = null;
    if (req.file?.path && fs.existsSync(req.file.path)) {
      buffer = fs.readFileSync(req.file.path);
    }
    try {
      await persistUploadMirror(filePath, {
        buffer,
        mimeType: req.file?.mimetype || 'image/jpeg',
      });
    } catch (error) {
      db.prepare('UPDATE trips SET photo_path = ? WHERE id = ?').run(activeTrip.photo_path, activeTrip.id);
      unlinkStoredUpload(filePath);
      return res.status(503).json({ error: error.message });
    }
  }
  const enriched = await enrichTripRowAsync(trip);
  return res.json(enriched);
});

router.post('/:id/photo-data', async (req, res) => {
  const id = Number(req.params.id);
  console.log('[trips][photo-data]', {
    id,
    userId: req.user?.id ?? null,
    bodyBytes: typeof req.body?.image_data === 'string' ? req.body.image_data.length : 0,
    mimeType: req.body?.mime_type ?? null,
  });

  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Некорректный id' });
  }

  const rawData = req.body?.image_data;
  if (typeof rawData !== 'string' || !rawData.trim()) {
    return res.status(400).json({ error: 'Фото обязательно (image_data)' });
  }

  let buffer;
  try {
    buffer = Buffer.from(rawData, 'base64');
  } catch {
    return res.status(400).json({ error: 'Некорректные данные фото (base64)' });
  }

  if (!buffer.length) {
    return res.status(400).json({ error: 'Файл фото пустой' });
  }
  if (buffer.length > 8 * 1024 * 1024) {
    return res.status(413).json({ error: 'Файл слишком большой (максимум 8 МБ)' });
  }

  const mimeType = req.body?.mime_type ? String(req.body.mime_type) : 'image/jpeg';
  return persistTripPhoto(req, res, id, buffer, mimeType);
});

router.post('/:id/photo', handlePhotoUpload, async (req, res) => {
  const id = Number(req.params.id);
  console.log('[trips][photo]', {
    id,
    hasFile: Boolean(req.file),
    fileSize: req.file?.size ?? 0,
    mimetype: req.file?.mimetype ?? null,
    contentType: String(req.headers['content-type'] || '').slice(0, 80),
    userId: req.user?.id ?? null,
  });
  if (!Number.isFinite(id) || id <= 0) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Некорректный id' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Фото обязательно' });
  }

  try {
    const buffer = fs.readFileSync(req.file.path);
    const mimeType = req.file.mimetype || 'image/jpeg';
    cleanupUploadedFile(req.file);
    return persistTripPhoto(req, res, id, buffer, mimeType);
  } catch (error) {
    cleanupUploadedFile(req.file);
    console.error('[trips][photo] read failed:', error.message);
    return res.status(500).json({ error: 'Не удалось сохранить фото' });
  }
});

router.delete('/:id/photo', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Некорректный id' });
  }

  const trip = db
    .prepare('SELECT id, order_id, driver_id, status, stage, photo_path FROM trips WHERE id = ?')
    .get(id);

  const access = validateTripPhotoDeleteAccess(req, trip);
  if (access.error) {
    return res.status(access.error.status).json({ error: access.error.message });
  }

  if (!trip.photo_path || !String(trip.photo_path).trim()) {
    return res.status(400).json({ error: 'У рейса нет прикреплённого фото' });
  }

  await removeStoredUpload(trip.photo_path);
  db.prepare('UPDATE trips SET photo_path = NULL WHERE id = ?').run(id);

  console.log('[trips][photo-delete]', { id, userId: req.user?.id ?? null });
  return res.json({ success: true, message: 'Фото удалено' });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Некорректный id' });
  }

  const trip = db
    .prepare('SELECT id, order_id, driver_id, stage, status, photo_path FROM trips WHERE id = ?')
    .get(id);
  if (!trip) return res.status(404).json({ error: 'Рейс не найден' });

  if (req.user.role !== 'admin') {
    const driverId = getDriverIdForUser(req.user.id);
    if (!driverId || Number(trip.driver_id) !== driverId) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    if (!isTripLoading(trip)) {
      return res.status(403).json({ error: 'Можно удалить только рейс в статусе погрузки' });
    }
  }

  deleteTripPhotoFiles(trip);

  db.prepare('DELETE FROM trips WHERE id = ?').run(id);
  return res.json({ ok: true, message: 'Рейс удалён' });
});

module.exports = router;
module.exports.ensureTripSchema = ensureTripSchema;
