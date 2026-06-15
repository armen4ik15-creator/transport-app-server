const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const {
  getPublicFuelSettings,
  updateFuelSettings,
} = require('../services/fuel/fuelSettings');
const {
  runFuelSync,
  testFuelConnection,
} = require('../services/fuel/fuelSyncService');
const { restartFuelScheduler } = require('../services/fuel/fuelScheduler');

const router = express.Router();
router.use(authMiddleware);

const TX_SELECT = `
  SELECT
    ft.id, ft.external_id, ft.source, ft.card_number, ft.driver_id,
    ft.transaction_at, ft.station_name, ft.amount, ft.liters, ft.car_number,
    ft.expense_id, ft.created_at,
    u.full_name AS driver_name
  FROM fuel_transactions ft
  LEFT JOIN drivers d ON d.id = ft.driver_id
  LEFT JOIN users u ON u.id = d.user_id
`;

function getDriverIdForUser(userId) {
  const row = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(userId);
  return row?.id ?? null;
}

router.get('/sync-status', (req, res) => {
  return res.json(getPublicFuelSettings());
});

router.get('/settings', requireRole('admin'), (_req, res) => {
  return res.json(getPublicFuelSettings());
});

router.put('/settings', requireRole('admin'), (req, res) => {
  try {
    const body = req.body || {};
    const updated = updateFuelSettings({
      data_source: body.data_source,
      opti_login: body.opti_login,
      opti_password: body.opti_password,
      sync_enabled: body.sync_enabled,
      sync_interval_minutes: body.sync_interval_minutes,
    });
    restartFuelScheduler();
    return res.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось сохранить настройки';
    return res.status(400).json({ error: message });
  }
});

router.post('/sync', requireRole('admin'), async (_req, res) => {
  const result = await runFuelSync();
  if (!result.ok && result.error) {
    return res.status(502).json({ error: result.error, ...result });
  }
  return res.json(result);
});

router.post('/test-connection', requireRole('admin'), async (_req, res) => {
  const result = await testFuelConnection();
  return res.json(result);
});

router.get('/cards', requireRole('admin'), (_req, res) => {
  const rows = db
    .prepare(
      `SELECT
         fc.id, fc.driver_id, fc.card_number, fc.label, fc.is_active, fc.created_at,
         d.car_number, u.full_name AS driver_name, u.email AS driver_email
       FROM fuel_cards fc
       JOIN drivers d ON d.id = fc.driver_id
       JOIN users u ON u.id = d.user_id
       ORDER BY fc.id DESC`
    )
    .all();
  return res.json(rows);
});

router.post('/cards', requireRole('admin'), (req, res) => {
  const { driver_id, card_number, label } = req.body || {};
  const safeDriverId = Number(driver_id);
  const safeCardNumber = card_number ? String(card_number).trim() : '';

  if (!Number.isFinite(safeDriverId) || safeDriverId <= 0) {
    return res.status(400).json({ error: 'driver_id обязателен' });
  }
  if (!safeCardNumber) {
    return res.status(400).json({ error: 'card_number обязателен' });
  }

  const driver = db.prepare('SELECT id FROM drivers WHERE id = ?').get(safeDriverId);
  if (!driver) return res.status(404).json({ error: 'Водитель не найден' });

  const exists = db.prepare('SELECT id FROM fuel_cards WHERE card_number = ?').get(safeCardNumber);
  if (exists) return res.status(409).json({ error: 'Карта уже привязана' });

  const result = db
    .prepare(
      `INSERT INTO fuel_cards (driver_id, card_number, label, is_active)
       VALUES (?, ?, ?, 1)`
    )
    .run(safeDriverId, safeCardNumber, label ? String(label).trim() : null);

  const row = db.prepare('SELECT * FROM fuel_cards WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json(row);
});

router.put('/cards/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'Некорректный id' });
  }

  const card = db.prepare('SELECT * FROM fuel_cards WHERE id = ?').get(id);
  if (!card) return res.status(404).json({ error: 'Карта не найдена' });

  const { driver_id, card_number, label, is_active } = req.body || {};
  const nextDriverId = driver_id != null ? Number(driver_id) : card.driver_id;
  const nextCardNumber = card_number != null ? String(card_number).trim() : card.card_number;
  const nextLabel = label !== undefined ? (label ? String(label).trim() : null) : card.label;
  const nextActive = is_active != null ? (is_active ? 1 : 0) : card.is_active;

  if (!nextCardNumber) {
    return res.status(400).json({ error: 'card_number не может быть пустым' });
  }

  const duplicate = db
    .prepare('SELECT id FROM fuel_cards WHERE card_number = ? AND id != ?')
    .get(nextCardNumber, id);
  if (duplicate) return res.status(409).json({ error: 'Карта уже привязана' });

  db.prepare(
    `UPDATE fuel_cards
     SET driver_id = ?, card_number = ?, label = ?, is_active = ?
     WHERE id = ?`
  ).run(nextDriverId, nextCardNumber, nextLabel, nextActive, id);

  const row = db.prepare('SELECT * FROM fuel_cards WHERE id = ?').get(id);
  return res.json(row);
});

router.delete('/cards/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const card = db.prepare('SELECT id FROM fuel_cards WHERE id = ?').get(id);
  if (!card) return res.status(404).json({ error: 'Карта не найдена' });
  db.prepare('DELETE FROM fuel_cards WHERE id = ?').run(id);
  return res.json({ ok: true });
});

router.get('/transactions', (req, res) => {
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  const requestedDriverId = req.query.driver_id ? Number(req.query.driver_id) : null;

  const where = [];
  const params = [];

  if (from) {
    where.push('date(ft.transaction_at) >= date(?)');
    params.push(from);
  }
  if (to) {
    where.push('date(ft.transaction_at) <= date(?)');
    params.push(to);
  }

  if (req.user.role === 'admin') {
    if (requestedDriverId) {
      where.push('ft.driver_id = ?');
      params.push(requestedDriverId);
    }
  } else {
    const ownDriverId = getDriverIdForUser(req.user.id);
    if (!ownDriverId) return res.json([]);
    where.push('ft.driver_id = ?');
    params.push(ownDriverId);
  }

  const rows = db
    .prepare(
      `${TX_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ft.transaction_at DESC, ft.id DESC`
    )
    .all(...params);
  return res.json(rows);
});

router.get('/sync-logs', requireRole('admin'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const rows = db
    .prepare(
      `SELECT id, started_at, finished_at, status, source,
              fetched_count, created_count, error_message
       FROM fuel_sync_logs
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit);
  return res.json(rows);
});

module.exports = router;
