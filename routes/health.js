const express = require('express');
const fs = require('fs');
const db = require('../database');
const { DB_PATH, DATA_DIR } = require('../config/paths');
const { buildConnectionString, getPostgresEnvDiagnostics } = require('../database/connection');
const { getStorageHealth } = require('../utils/storageHealth');

const router = express.Router();

router.get('/live', (_req, res) => {
  res.json({
    status: 'ok',
    app_version: process.env.APP_VERSION || '1.3.0',
    git_commit: process.env.GIT_COMMIT_SHA || null,
    driver_registration_available: true,
  });
});

router.get('/', (_req, res) => {
  const env = getPostgresEnvDiagnostics();
  const storage = getStorageHealth();
  const payload = {
    status: 'ok',
    app_version: process.env.APP_VERSION || '1.2.1',
    db_kind: db.kind || 'sqlite',
    data_dir: DATA_DIR,
    upload_dir: storage.upload_dir,
    upload_dir_exists: storage.upload_dir_exists,
    upload_dir_writable: storage.upload_dir_writable,
    persistent_volume: storage.persistent_volume,
    storage,
    env,
  };

  if (db.kind === 'postgres_error') {
    payload.status = 'ok';
    payload.db_status = 'degraded';
    payload.db_connected = false;
    const cause = db.initError?.internalCause || db.initError;
    payload.db_error = cause?.message || db.initError?.message || 'PostgreSQL connection failed';
    if (cause?.code) payload.db_error_code = cause.code;
    payload.hint =
      'Reset gen_user password in DB panel, copy the same value to DB_PASSWORD, click Save, redeploy.';
    return res.json(payload);
  }

  if (db.kind === 'postgres') {
    payload.db_connected = true;
    payload.database_url_set = Boolean(buildConnectionString());
    const pingStartedAt = Date.now();
    try {
      db.prepare('SELECT 1').get();
      payload.db_ping_ms = Date.now() - pingStartedAt;
    } catch (pingError) {
      payload.db_ping_ms = Date.now() - pingStartedAt;
      payload.db_ping_error = pingError.message;
    }
    return res.json(payload);
  }

  payload.db_path = DB_PATH;
  payload.db_exists = fs.existsSync(DB_PATH);
  if (!env.postgres_configured) {
    payload.hint =
      'Set DB_HOST, DB_USER, DB_PASSWORD in deploy settings, save, then redeploy.';
  }
  return res.json(payload);
});

/**
 * Временная диагностика привязок устройств для отладки HMAC.
 * Доступна только при HMAC_DEBUG=1 и совпадении ?key= с HMAC_DEBUG_KEY.
 * Секреты не раскрываются (только длина). Удалить после диагностики.
 */
router.get('/hmac-devices', (req, res) => {
  const enabled = process.env.HMAC_DEBUG === '1' && Boolean(process.env.HMAC_DEBUG_KEY);
  if (!enabled || String(req.query.key || '') !== String(process.env.HMAC_DEBUG_KEY)) {
    return res.status(404).json({ error: 'Not found' });
  }

  const email = req.query.email ? String(req.query.email).toLowerCase() : null;
  try {
    const rows = db
      .prepare(
        `SELECT ds.id, ds.device_id, ds.user_id, u.email, u.role,
                ds.blocked, ds.block_reason, ds.app_version, ds.platform,
                length(ds.secret) AS secret_len, ds.created_at, ds.last_seen_at
         FROM device_secrets ds
         LEFT JOIN users u ON u.id = ds.user_id
         ${email ? 'WHERE LOWER(u.email) = ?' : ''}
         ORDER BY ds.last_seen_at DESC NULLS LAST, ds.id DESC
         LIMIT 100`
      )
      .all(...(email ? [email] : []));
    return res.json({
      count: rows.length,
      devices: rows.map((r) => ({
        id: r.id,
        device_id: r.device_id,
        user_id: r.user_id,
        email: r.email,
        role: r.role,
        blocked: r.blocked,
        block_reason: r.block_reason,
        app_version: r.app_version,
        platform: r.platform,
        secret_len: r.secret_len,
        created_at: r.created_at,
        last_seen_at: r.last_seen_at,
      })),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/** Последние решения HMAC-middleware (только при HMAC_DEBUG=1 + ключ). Удалить после диагностики. */
router.get('/hmac-events', (req, res) => {
  const enabled = process.env.HMAC_DEBUG === '1' && Boolean(process.env.HMAC_DEBUG_KEY);
  if (!enabled || String(req.query.key || '') !== String(process.env.HMAC_DEBUG_KEY)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const { getRecentHmacEvents } = require('../middleware/hmac');
  const events = getRecentHmacEvents();
  return res.json({ count: events.length, events });
});

module.exports = router;
