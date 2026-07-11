const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { uploadsSubdir } = require('../config/paths');
const { queueUploadMirror } = require('../utils/uploadPersistence');

const router = express.Router();
router.use(authMiddleware);

const UPLOAD_DIR = uploadsSubdir('vehicle-documents');
const ALLOWED_TYPES = new Set(['sts', 'contract', 'pts', 'insurance', 'driver_passport']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `vehicle_doc_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = file.mimetype || '';
    if (mime.startsWith('image/') || mime === 'application/pdf') {
      return cb(null, true);
    }
    return cb(new Error('Разрешены изображения и PDF'));
  },
});

const SELECT_SQL = `
  SELECT
    vd.id,
    vd.vehicle_id,
    vd.doc_type,
    vd.file_path,
    vd.created_by,
    vd.created_at,
    v.plate_number AS vehicle_plate,
    u.email AS created_by_email
  FROM vehicle_documents vd
  JOIN vehicles v ON v.id = vd.vehicle_id
  LEFT JOIN users u ON u.id = vd.created_by
`;

router.get('/', (req, res) => {
  const vehicleId = req.query.vehicle_id ? Number(req.query.vehicle_id) : null;

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Доступ только для администратора' });
  }

  if (vehicleId) {
    const rows = db
      .prepare(`${SELECT_SQL} WHERE vd.vehicle_id = ? ORDER BY vd.created_at DESC`)
      .all(vehicleId);
    return res.json(rows);
  }

  const rows = db.prepare(`${SELECT_SQL} ORDER BY vd.created_at DESC`).all();
  return res.json(rows);
});

router.post('/', requireRole('admin'), upload.single('file'), (req, res) => {
  const vehicleId = Number(req.body?.vehicle_id);
  const docType = String(req.body?.doc_type || '').trim();

  if (!Number.isFinite(vehicleId) || vehicleId <= 0) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'vehicle_id обязателен' });
  }

  if (!ALLOWED_TYPES.has(docType)) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Недопустимый тип документа' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Файл обязателен' });
  }

  const vehicle = db.prepare('SELECT id FROM vehicles WHERE id = ?').get(vehicleId);
  if (!vehicle) {
    fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Автомобиль не найден' });
  }

  const relativePath = `/uploads/vehicle-documents/${path.basename(req.file.path)}`;
  queueUploadMirror(relativePath, { absolutePath: req.file.path, mimeType: req.file.mimetype });
  const result = db
    .prepare(
      `INSERT INTO vehicle_documents (vehicle_id, doc_type, file_path, created_by)
       VALUES (?, ?, ?, ?)`
    )
    .run(vehicleId, docType, relativePath, req.user.id);

  const row = db.prepare(`${SELECT_SQL} WHERE vd.id = ?`).get(result.lastInsertRowid);
  return res.status(201).json(row);
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id, file_path FROM vehicle_documents WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Документ не найден' });

  db.prepare('DELETE FROM vehicle_documents WHERE id = ?').run(id);

  if (row.file_path) {
    const absolute = path.join(
      require('../config/paths').UPLOADS_DIR,
      row.file_path.replace(/^\/uploads\//, '')
    );
    fs.unlink(absolute, () => {});
  }

  return res.json({ ok: true });
});

module.exports = router;
