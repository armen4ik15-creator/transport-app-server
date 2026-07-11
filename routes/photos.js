const express = require('express');
const path = require('path');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { normalizeUploadWebPath, resolveUploadAbsolutePath } = require('../utils/uploadPaths');

const router = express.Router();

router.use(authMiddleware);

function getDriverIdForUser(userId) {
  const row = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(userId);
  return row ? row.id : null;
}

function parsePositiveInt(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

const ORDER_PHOTOS_SELECT = `
  SELECT
    op.id AS id,
    op.order_id,
    op.file_path,
    op.uploaded_by,
    op.uploaded_at,
    du.full_name AS driver_name,
    o.created_at AS order_date,
    c.name AS contractor_name,
    o.material,
    o.driver_id,
    NULL AS trip_id,
    NULL AS ttn_number,
    'order' AS source
  FROM order_photos op
  JOIN orders o ON o.id = op.order_id
  LEFT JOIN contractors c ON c.id = o.contractor_id
  LEFT JOIN drivers d ON d.id = o.driver_id
  LEFT JOIN users du ON du.id = d.user_id
`;

const TRIP_PHOTOS_SELECT = `
  SELECT
    (1000000000 + t.id) AS id,
    t.order_id,
    t.photo_path AS file_path,
    t.created_by AS uploaded_by,
    COALESCE(t.completed_at, t.created_at) AS uploaded_at,
    du.full_name AS driver_name,
    o.created_at AS order_date,
    c.name AS contractor_name,
    o.material,
    t.driver_id,
    t.id AS trip_id,
    t.ttn_number,
    'trip' AS source
  FROM trips t
  JOIN orders o ON o.id = t.order_id
  LEFT JOIN contractors c ON c.id = o.contractor_id
  LEFT JOIN drivers d ON d.id = t.driver_id
  LEFT JOIN users du ON du.id = d.user_id
  WHERE t.photo_path IS NOT NULL AND trim(t.photo_path) != ''
`;

function buildFilters(req) {
  const where = [];
  const params = [];

  let driverId = req.query.driver_id ? Number(req.query.driver_id) : null;
  const orderId = req.query.order_id ? Number(req.query.order_id) : null;
  const dateFrom = req.query.date_from ? String(req.query.date_from) : null;
  const dateTo = req.query.date_to ? String(req.query.date_to) : null;

  if (req.user.role !== 'admin') {
    driverId = getDriverIdForUser(req.user.id);
    if (!driverId) {
      return { where, params, empty: true };
    }
  }

  if (driverId && Number.isFinite(driverId) && driverId > 0) {
    where.push('driver_id = ?');
    params.push(driverId);
  }
  if (orderId && Number.isFinite(orderId) && orderId > 0) {
    where.push('order_id = ?');
    params.push(orderId);
  }
  if (dateFrom) {
    where.push("date(uploaded_at) >= date(?)");
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push("date(uploaded_at) <= date(?)");
    params.push(dateTo);
  }

  return { where, params, empty: false };
}

router.get('/', async (req, res) => {
  const limit = Math.min(parsePositiveInt(req.query.limit, 50), 200);
  const offset = parsePositiveInt(req.query.offset, 0);
  const { where, params, empty } = buildFilters(req);

  if (empty) {
    return res.json([]);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT * FROM (
      ${ORDER_PHOTOS_SELECT}
      UNION ALL
      ${TRIP_PHOTOS_SELECT}
    ) AS all_photos
    ${whereClause}
    ORDER BY uploaded_at DESC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(sql).all(...params, limit, offset);
  // Не дергаем S3 HeadObject на каждый файл — он занимает 10–15с и роняет API.
  // Доступность подтверждается при реальной отдаче GET /api/photos/file.
  const enriched = rows.map((row) => ({
    ...row,
    photo_available: Boolean(row.file_path && String(row.file_path).trim()),
  }));
  return res.json(enriched);
});

/** Отдача файла через /api — локальный диск или S3 Timeweb. */
router.get('/file', async (req, res) => {
  const relativePath = req.query.path;
  if (!relativePath || typeof relativePath !== 'string') {
    return res.status(400).json({ error: 'path required' });
  }

  const normalizedPath = normalizeUploadWebPath(relativePath);
  if (!normalizedPath) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const absolute = resolveUploadAbsolutePath(normalizedPath);
  if (absolute) {
    return res.sendFile(path.resolve(absolute));
  }

  try {
    const streamed = await require('../utils/uploadsStorage').streamUploadToResponse(
      normalizedPath,
      res
    );
    if (streamed) return undefined;
  } catch (error) {
    console.warn('[photos] S3 stream failed:', error.message);
  }

  return res.status(404).json({
    error: 'File not found',
    path: normalizedPath,
  });
});

module.exports = router;
