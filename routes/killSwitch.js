const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);
router.use(requireRole('admin'));

function blockDevice(deviceId, reason, adminId) {
  const row = db
    .prepare('SELECT id, device_id FROM device_secrets WHERE device_id = ?')
    .get(deviceId);

  if (!row) {
    return { found: false };
  }

  db.prepare(
    `UPDATE device_secrets
     SET blocked = 1, block_reason = ?, blocked_by = ?, blocked_at = ?
     WHERE id = ?`
  ).run(reason, adminId, new Date().toISOString(), row.id);

  return { found: true, device_id: row.device_id };
}

router.post('/kill-switch/:deviceId', (req, res) => {
  const deviceId = String(req.params.deviceId || '').trim();
  const reason = String(req.body?.reason || 'Заблокировано администратором').slice(0, 500);

  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId обязателен' });
  }

  const result = blockDevice(deviceId, reason, req.user.id);
  if (!result.found) {
    return res.status(404).json({ error: 'Устройство не найдено' });
  }

  return res.json({ ok: true, device_id: result.device_id, blocked: true });
});

router.post('/kill-switch/client/:clientId', (req, res) => {
  const clientId = Number(req.params.clientId);
  const reason = String(req.body?.reason || 'Клиент заблокирован администратором').slice(0, 500);

  if (!Number.isFinite(clientId) || clientId <= 0) {
    return res.status(400).json({ error: 'clientId должен быть положительным числом' });
  }

  const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(clientId);
  if (!userExists) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE device_secrets
       SET blocked = 1, block_reason = ?, blocked_by = ?, blocked_at = ?
       WHERE user_id = ?`
    )
    .run(reason, req.user.id, now, clientId);

  return res.json({
    ok: true,
    client_id: clientId,
    blocked_devices: result.changes ?? 0,
  });
});

router.post('/kill-switch/unblock/:deviceId', (req, res) => {
  const deviceId = String(req.params.deviceId || '').trim();
  if (!deviceId) {
    return res.status(400).json({ error: 'deviceId обязателен' });
  }

  const result = db
    .prepare(
      `UPDATE device_secrets
       SET blocked = 0, block_reason = NULL, blocked_by = NULL, blocked_at = NULL
       WHERE device_id = ?`
    )
    .run(deviceId);

  if (!result.changes) {
    return res.status(404).json({ error: 'Устройство не найдено' });
  }

  return res.json({ ok: true, device_id: deviceId, blocked: false });
});

module.exports = router;
