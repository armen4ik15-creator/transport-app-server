const crypto = require('crypto');
const express = require('express');
const db = require('../database');

const router = express.Router();

function hashMatches(storedToken, providedHash) {
  if (!storedToken || !providedHash) return false;
  const expected = crypto.createHash('sha256').update(storedToken).digest('hex');
  const provided = String(providedHash).trim().toLowerCase();
  if (expected.length !== provided.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return false;
  }
}

router.post('/', (req, res) => {
  const deviceId = String(req.body?.device_id || '').trim();
  const activationToken = String(req.body?.activation_token || '').trim();
  const codeHash = String(req.body?.code_hash || '').trim();

  if (!deviceId) {
    return res.status(400).json({ error: 'device_id обязателен' });
  }

  const row = db
    .prepare(
      `SELECT id, user_id, activation_token, blocked, block_reason
       FROM device_secrets
       WHERE device_id = ?`
    )
    .get(deviceId);

  if (!row) {
    return res.status(404).json({ error: 'Устройство не найдено', blocked: true });
  }

  if (Number(row.blocked) === 1) {
    return res.status(403).json({
      ok: false,
      blocked: true,
      reason: row.block_reason || 'Доступ заблокирован администратором',
    });
  }

  if (activationToken && row.activation_token !== activationToken) {
    return res.status(403).json({
      ok: false,
      blocked: true,
      reason: 'Недействительный токен активации',
    });
  }

  if (codeHash && !hashMatches(row.activation_token, codeHash)) {
    return res.status(403).json({
      ok: false,
      blocked: true,
      reason: 'Ошибка проверки целостности',
    });
  }

  db.prepare(
    `UPDATE device_secrets
     SET last_heartbeat_at = ?
     WHERE id = ?`
  ).run(new Date().toISOString(), row.id);

  return res.json({ ok: true, blocked: false });
});

module.exports = router;
