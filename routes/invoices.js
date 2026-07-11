const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');
const { uploadsSubdir } = require('../config/paths');
const { queueUploadMirror } = require('../utils/uploadPersistence');

const router = express.Router();
router.use(authMiddleware);

const INVOICES_UPLOAD_DIR = uploadsSubdir('invoices');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, INVOICES_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.pdf';
    cb(null, `invoice_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

function getDriverIdForUser(userId) {
  const row = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(userId);
  return row ? row.id : null;
}

function canAccessOrder(req, order) {
  if (req.user.role === 'admin') return true;
  const ownDriverId = getDriverIdForUser(req.user.id);
  return ownDriverId != null && Number(order.driver_id) === ownDriverId;
}

const SELECT_SQL = `
  SELECT
    i.id, i.order_id, i.number, i.date, i.amount, i.file_path, i.created_by, i.created_at,
    o.driver_id,
    c.name AS contractor_name
  FROM invoices i
  JOIN orders o ON o.id = i.order_id
  LEFT JOIN contractors c ON c.id = o.contractor_id
`;

router.get('/', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.order_id) {
    where.push('i.order_id = ?');
    params.push(Number(req.query.order_id));
  }
  if (req.user.role !== 'admin') {
    const ownDriverId = getDriverIdForUser(req.user.id);
    if (!ownDriverId) return res.json([]);
    where.push('o.driver_id = ?');
    params.push(ownDriverId);
  }
  const rows = db
    .prepare(`${SELECT_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.date DESC, i.id DESC`)
    .all(...params);
  return res.json(rows);
});

router.post('/', upload.single('file'), (req, res) => {
  const { order_id, number, date, amount } = req.body || {};
  const orderId = Number(order_id);
  if (!Number.isFinite(orderId) || orderId <= 0 || !number || !String(number).trim()) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'order_id и number обязательны' });
  }
  const order = db.prepare('SELECT id, driver_id FROM orders WHERE id = ?').get(orderId);
  if (!order) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Заказ не найден' });
  }
  if (!canAccessOrder(req, order)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  const filePath = req.file ? `/uploads/invoices/${req.file.filename}` : null;
  if (filePath && req.file) {
    queueUploadMirror(filePath, { absolutePath: req.file.path, mimeType: req.file.mimetype });
  }
  const result = db
    .prepare(
      `INSERT INTO invoices (order_id, number, date, amount, file_path, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      orderId,
      String(number).trim(),
      date ? String(date).trim() : new Date().toISOString().slice(0, 10),
      amount == null || amount === '' ? null : Number(amount),
      filePath,
      req.user.id
    );
  logActivity(req.user.id, 'invoices.create', { invoice_id: result.lastInsertRowid, order_id: orderId });
  const created = db.prepare(`${SELECT_SQL} WHERE i.id = ?`).get(result.lastInsertRowid);
  return res.status(201).json(created);
});

router.put('/:id', upload.single('file'), (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare(`${SELECT_SQL} WHERE i.id = ?`).get(id);
  if (!current) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Счёт не найден' });
  }
  if (!canAccessOrder(req, current)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  const { number, date, amount } = req.body || {};
  const nextFilePath = req.file ? `/uploads/invoices/${req.file.filename}` : null;
  if (nextFilePath && req.file) {
    queueUploadMirror(nextFilePath, { absolutePath: req.file.path, mimeType: req.file.mimetype });
  }
  db.prepare(
    `UPDATE invoices
     SET number = COALESCE(?, number),
         date = COALESCE(?, date),
         amount = COALESCE(?, amount),
         file_path = COALESCE(?, file_path)
     WHERE id = ?`
  ).run(
    number ? String(number).trim() : null,
    date ? String(date).trim() : null,
    amount == null || amount === '' ? null : Number(amount),
    nextFilePath,
    id
  );
  logActivity(req.user.id, 'invoices.update', { invoice_id: id });
  const updated = db.prepare(`${SELECT_SQL} WHERE i.id = ?`).get(id);
  return res.json(updated);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare(`${SELECT_SQL} WHERE i.id = ?`).get(id);
  if (!current) return res.status(404).json({ error: 'Счёт не найден' });
  if (!canAccessOrder(req, current)) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  logActivity(req.user.id, 'invoices.delete', { invoice_id: id });
  return res.json({ ok: true });
});

module.exports = router;
