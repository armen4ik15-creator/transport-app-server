const crypto = require('crypto');
const express = require('express');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function generateActivationToken() {
  return crypto.randomBytes(24).toString('hex');
}

router.post('/register', authMiddleware, (req, res) => {
  const deviceId = String(req.body?.device_id || '').trim();
  const platform = String(req.body?.platform || 'unknown').slice(0, 64);
  const appVersion = String(req.body?.app_version || 'unknown').slice(0, 32);

  if (!deviceId || deviceId.length < 8) {
    return res.status(400).json({ error: 'device_id обязателен (минимум 8 символов)' });
  }

  const existing = db
    .prepare(
      `SELECT id, user_id, secret, activation_token, blocked, block_reason
       FROM device_secrets
       WHERE device_id = ?`
    )
    .get(deviceId);

  if (existing) {
    if (Number(existing.blocked) === 1) {
      return res.status(403).json({
        error: existing.block_reason || 'Устройство заблокировано',
        blocked: true,
      });
    }

    if (Number(existing.user_id) !== Number(req.user.id)) {
      const reboundSecret = generateSecret();
      const reboundToken = generateActivationToken();
      const reboundNow = new Date().toISOString();

      db.prepare(
        `UPDATE device_secrets
         SET user_id = ?, secret = ?, activation_token = ?, platform = ?, app_version = ?, last_seen_at = ?
         WHERE id = ?`
      ).run(
        req.user.id,
        reboundSecret,
        reboundToken,
        platform,
        appVersion,
        reboundNow,
        existing.id
      );

      return res.json({
        device_id: deviceId,
        secret: reboundSecret,
        activation_token: reboundToken,
        reused: false,
        rebound: true,
      });
    }

    db.prepare(
      `UPDATE device_secrets
       SET platform = ?, app_version = ?, last_seen_at = ?
       WHERE id = ?`
    ).run(platform, appVersion, new Date().toISOString(), existing.id);

    return res.json({
      device_id: deviceId,
      secret: existing.secret,
      activation_token: existing.activation_token,
      reused: true,
    });
  }

  const secret = generateSecret();
  const activationToken = generateActivationToken();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO device_secrets
     (device_id, user_id, secret, activation_token, platform, app_version, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(deviceId, req.user.id, secret, activationToken, platform, appVersion, now, now);

  return res.status(201).json({
    device_id: deviceId,
    secret,
    activation_token: activationToken,
    reused: false,
  });
});

module.exports = router;
