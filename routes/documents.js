const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'documents');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `doc_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Разрешены только изображения'));
    }
    cb(null, true);
  },
});

function getDriverIdForUser(userId) {
  const row = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(userId);
  return row ? row.id : null;
}

function canAccessOrder(user, order) {
  if (user.role === 'admin') return true;
  const driverId = getDriverIdForUser(user.id);
  return Boolean(driverId && order.driver_id === driverId);
}

const DOC_SELECT = `
  SELECT
    d.id, d.order_id, d.type, d.file_path, d.created_by, d.created_at,
    o.driver_id,
    u.email AS created_by_email
  FROM documents d
  JOIN orders o ON o.id = d.order_id
  JOIN users u ON u.id = d.created_by
`;

router.get('/', (req, res) => {
  const orderId = req.query.order_id ? Number(req.query.order_id) : null;

  if (req.user.role === 'admin') {
    if (orderId) {
      const rows = db
        .prepare(`${DOC_SELECT} WHERE d.order_id = ? ORDER BY d.created_at DESC`)
        .all(orderId);
      return res.json(rows);
    }
    const rows = db.prepare(`${DOC_SELECT} ORDER BY d.created_at DESC`).all();
    return res.json(rows);
  }

  const ownDriverId = getDriverIdForUser(req.user.id);
  if (!ownDriverId) return res.json([]);

  if (orderId) {
    const rows = db
      .prepare(
        `${DOC_SELECT}
         WHERE d.order_id = ? AND o.driver_id = ?
         ORDER BY d.created_at DESC`
      )
      .all(orderId, ownDriverId);
    return res.json(rows);
  }

  const rows = db
    .prepare(`${DOC_SELECT} WHERE o.driver_id = ? ORDER BY d.created_at DESC`)
    .all(ownDriverId);
  return res.json(rows);
});

router.post('/', upload.single('file'), (req, res) => {
  const { order_id, type } = req.body || {};
  if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
  if (!order_id || !type) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'order_id и type обязательны' });
  }
  if (!['waybill', 'invoice', 'act'].includes(type)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'type должен быть waybill, invoice или act' });
  }

  const order = db
    .prepare('SELECT id, driver_id FROM orders WHERE id = ?')
    .get(Number(order_id));
  if (!order) {
    fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Заказ не найден' });
  }
  if (!canAccessOrder(req.user, order)) {
    fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: 'Нельзя загружать документы для этого заказа' });
  }

  const filePath = `/uploads/documents/${req.file.filename}`;
  const result = db
    .prepare(
      'INSERT INTO documents (order_id, type, file_path, created_by) VALUES (?, ?, ?, ?)'
    )
    .run(Number(order_id), type, filePath, req.user.id);

  const doc = db.prepare(`${DOC_SELECT} WHERE d.id = ?`).get(result.lastInsertRowid);
  return res.status(201).json(doc);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const doc = db
    .prepare(
      `SELECT d.id, d.file_path, d.created_by
       FROM documents d
       WHERE d.id = ?`
    )
    .get(id);
  if (!doc) return res.status(404).json({ error: 'Документ не найден' });

  if (req.user.role !== 'admin' && doc.created_by !== req.user.id) {
    return res.status(403).json({ error: 'Удалять может только автор или admin' });
  }

  db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  const absolute = path.join(__dirname, '..', doc.file_path.replace(/^\//, ''));
  fs.unlink(absolute, () => {});
  return res.json({ ok: true });
});

module.exports = router;
