const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { uploadsSubdir } = require('../config/paths');
const { queueUploadMirror } = require('../utils/uploadPersistence');
const { findDuplicateImportMarker } = require('../utils/importMarkers');

const router = express.Router();
router.use(authMiddleware);

const EXPENSES_UPLOAD_DIR = uploadsSubdir('expenses');

const DRIVER_EXPENSE_TYPES = new Set(['dps', 'toll', 'supplies', 'other']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, EXPENSES_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `expense_${Date.now()}${ext}`);
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

function getDriverIdForUser(userId) {
  const row = db.prepare('SELECT id, car_number FROM drivers WHERE user_id = ?').get(userId);
  return row || null;
}

function cleanupUploadedFile(file) {
  if (!file?.path) return;
  try {
    fs.unlinkSync(file.path);
  } catch {
    // ignore missing file
  }
}

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

const EXPENSE_SELECT = `
  SELECT
    e.id, e.exp_date, e.exp_type, e.method, e.amount, e.comment,
    e.driver_id, e.car_number, e.created_by, e.created_at,
    e.status, e.source, e.rejection_reason, e.photo_path, e.updated_at,
    u.full_name AS driver_name
  FROM expenses e
  LEFT JOIN drivers d ON d.id = e.driver_id
  LEFT JOIN users u ON u.id = d.user_id
`;

function normalizeExpenseRow(row) {
  if (!row) return row;
  return {
    ...row,
    status: row.status ?? 'approved',
    source: row.source ?? 'admin',
  };
}

router.get('/', (req, res) => {
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  const requestedDriverId = req.query.driver_id ? Number(req.query.driver_id) : null;
  const statusFilter = req.query.status ? String(req.query.status) : null;

  const where = [];
  const params = [];

  if (from) {
    where.push('date(e.exp_date) >= date(?)');
    params.push(from);
  }
  if (to) {
    where.push('date(e.exp_date) <= date(?)');
    params.push(to);
  }
  if (statusFilter && ['pending', 'approved', 'rejected'].includes(statusFilter)) {
    where.push('e.status = ?');
    params.push(statusFilter);
  }

  if (req.user.role === 'admin') {
    if (requestedDriverId) {
      where.push('e.driver_id = ?');
      params.push(requestedDriverId);
    }
  } else {
    const own = getDriverIdForUser(req.user.id);
    if (!own) return res.json([]);
    where.push('e.driver_id = ?');
    params.push(own.id);
  }

  const rows = db
    .prepare(
      `${EXPENSE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.exp_date DESC, e.id DESC`
    )
    .all(...params);
  return res.json(rows.map(normalizeExpenseRow));
});

router.post('/', upload.single('photo'), (req, res) => {
  const body = req.body || {};
  const { exp_date, exp_type, method, amount, comment, driver_id, car_number } = body;

  if (amount == null) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'amount обязателен' });
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'amount должен быть положительным числом' });
  }

  const isDriver = req.user.role !== 'admin';
  const safeExpType = (exp_type && String(exp_type).trim()) || 'other';
  const asCompensation =
    body.as_compensation === true ||
    body.as_compensation === 'true' ||
    body.as_compensation === 1 ||
    body.as_compensation === '1';
  const offSettlementFlag =
    body.off_settlement === true ||
    body.off_settlement === 'true' ||
    body.off_settlement === 1 ||
    body.off_settlement === '1' ||
    String(method || '').trim().toLowerCase() === 'none' ||
    asCompensation;

  if (isDriver && !DRIVER_EXPENSE_TYPES.has(safeExpType)) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({ error: 'Недопустимый тип расхода для водителя' });
  }

  if (method && !['cash', 'noncash', 'none'].includes(String(method).trim().toLowerCase())) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({
      error: 'method: noncash (р/с), cash (касса/снятие ИП) или none (только P&L, без р/с)',
    });
  }
  // Админские расходы на р/с/кассу обязаны иметь method.
  // method=none / off_settlement=true — возмещения и P&L-only (НЕ трогают оценку р/с).
  // Исторический баг ~45 тыс.: возмещения с method=noncash дважды били р/с.
  if (!isDriver && !method && !offSettlementFlag) {
    cleanupUploadedFile(req.file);
    return res.status(400).json({
      error:
        'Укажите method: noncash (р/с), cash (касса/снятие ИП) или none/off_settlement (только P&L)',
    });
  }

  let safeDriverId = driver_id ? Number(driver_id) : null;
  let safeCarNumber = car_number ? String(car_number).trim() : null;
  const safeExpDate =
    exp_date && String(exp_date).trim()
      ? String(exp_date).trim()
      : new Date().toISOString().slice(0, 10);

  let expenseStatus = 'approved';
  let expenseSource = 'admin';

  if (isDriver) {
    const own = getDriverIdForUser(req.user.id);
    if (!own) {
      cleanupUploadedFile(req.file);
      return res.status(403).json({ error: 'У водителя не заполнен профиль' });
    }
    safeDriverId = own.id;
    safeCarNumber = own.car_number || safeCarNumber || null;
    expenseStatus = 'pending';
    expenseSource = 'driver';
  } else if (safeDriverId) {
    const exists = db.prepare('SELECT id FROM drivers WHERE id = ?').get(safeDriverId);
    if (!exists) {
      cleanupUploadedFile(req.file);
      return res.status(404).json({ error: 'Водитель не найден' });
    }
    if (asCompensation) {
      expenseSource = 'driver';
      expenseStatus = 'approved';
    }
  }

  const photoPath = req.file ? `/uploads/expenses/${req.file.filename}` : null;
  if (photoPath && req.file) {
    queueUploadMirror(photoPath, { absolutePath: req.file.path, mimeType: req.file.mimetype });
  }
  // Водитель и off_settlement — никогда не списывают р/с напрямую.
  const safeMethod = isDriver || offSettlementFlag ? null : method || null;
  const timestamp = nowIso();
  const safeComment = (comment && String(comment).trim()) || null;

  if (!isDriver && safeComment) {
    const duplicate = findDuplicateImportMarker(db, 'expenses', safeComment, {
      amount: numericAmount,
    });
    if (duplicate) {
      cleanupUploadedFile(req.file);
      return res.status(409).json({
        error: `Дубликат импорта: маркер ${duplicate.marker} уже в расходе #${duplicate.id}`,
        existing_id: duplicate.id,
        marker: duplicate.marker,
      });
    }
  }

  const result = db
    .prepare(
      `INSERT INTO expenses
       (exp_date, exp_type, method, amount, comment, driver_id, car_number, created_by,
        status, source, photo_path, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      safeExpDate,
      safeExpType,
      safeMethod,
      numericAmount,
      safeComment,
      safeDriverId,
      safeCarNumber,
      req.user.id,
      expenseStatus,
      expenseSource,
      photoPath,
      timestamp
    );

  const row = db.prepare(`${EXPENSE_SELECT} WHERE e.id = ?`).get(result.lastInsertRowid);
  return res.status(201).json(normalizeExpenseRow(row));
});

router.patch('/:id/review', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Некорректный id' });
  }

  const { action, rejection_reason: rejectionReasonRaw } = req.body || {};
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action должен быть approve или reject' });
  }

  const expense = db
    .prepare('SELECT id, source, status FROM expenses WHERE id = ?')
    .get(id);
  if (!expense) return res.status(404).json({ error: 'Расход не найден' });

  if (expense.source !== 'driver') {
    return res.status(400).json({ error: 'Можно проверять только расходы водителя' });
  }
  if (expense.status !== 'pending') {
    return res.status(400).json({ error: 'Расход уже проверен' });
  }

  let rejectionReason = null;
  if (action === 'reject') {
    rejectionReason = rejectionReasonRaw ? String(rejectionReasonRaw).trim() : '';
    if (!rejectionReason) {
      return res.status(400).json({ error: 'rejection_reason обязателен при отклонении' });
    }
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  // Возмещения водителя никогда не должны получить method cash/noncash при approve —
  // иначе снова появится двойной удар по оценке р/с.
  if (action === 'approve' && expense.source === 'driver') {
    db.prepare(
      `UPDATE expenses
       SET status = ?, rejection_reason = ?, method = NULL, updated_at = ?
       WHERE id = ?`
    ).run(newStatus, rejectionReason, nowIso(), id);
  } else {
    db.prepare(
      `UPDATE expenses
       SET status = ?, rejection_reason = ?, updated_at = ?
       WHERE id = ?`
    ).run(newStatus, rejectionReason, nowIso(), id);
  }

  const row = db.prepare(`${EXPENSE_SELECT} WHERE e.id = ?`).get(id);
  return res.json(normalizeExpenseRow(row));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Некорректный id' });
  }

  const expense = db
    .prepare('SELECT id, driver_id, status, source, photo_path FROM expenses WHERE id = ?')
    .get(id);
  if (!expense) return res.status(404).json({ error: 'Расход не найден' });

  if (req.user.role !== 'admin') {
    const own = getDriverIdForUser(req.user.id);
    if (!own || Number(expense.driver_id) !== own.id) {
      return res.status(403).json({ error: 'Недостаточно прав' });
    }
    if (expense.status !== 'pending' || expense.source !== 'driver') {
      return res.status(403).json({ error: 'Можно удалить только ожидающие расходы' });
    }
  }

  db.prepare('DELETE FROM expenses WHERE id = ?').run(id);

  if (expense.photo_path) {
    const relative = String(expense.photo_path).replace(/^\/uploads\/expenses\//, '');
    const filePath = path.join(EXPENSES_UPLOAD_DIR, relative);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore file cleanup errors
    }
  }

  return res.json({ ok: true });
});

module.exports = router;
