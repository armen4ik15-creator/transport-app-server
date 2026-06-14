const express = require('express');
const fs = require('fs');
const db = require('../database');
const { DB_PATH, DATA_DIR } = require('../config/paths');
const { buildConnectionString, getPostgresEnvDiagnostics } = require('../database/connection');

const router = express.Router();

router.get('/', (_req, res) => {
  const env = getPostgresEnvDiagnostics();
  const payload = {
    status: 'ok',
    app_version: process.env.APP_VERSION || '1.2.1',
    db_kind: db.kind || 'sqlite',
    data_dir: DATA_DIR,
    env,
  };

  if (db.kind === 'postgres_error') {
    payload.status = 'degraded';
    payload.db_connected = false;
    payload.db_error = db.initError?.message || 'PostgreSQL connection failed';
    payload.hint =
      'Reset gen_user password in DB panel, copy the same value to DB_PASSWORD, click Save, redeploy.';
    return res.json(payload);
  }

  if (db.kind === 'postgres') {
    try {
      db.ping();
      payload.db_connected = true;
      payload.database_url_set = Boolean(buildConnectionString());
    } catch (error) {
      payload.db_connected = false;
      payload.db_error = error.message;
      payload.status = 'degraded';
    }
    try {
      const { getBackupStatus } = require('../services/backup/backupService');
      const backup = getBackupStatus();
      payload.last_backup_at = backup.latest?.createdAt ?? null;
      payload.backup_remote_s3 = backup.remote.s3;
    } catch {
      // backup module optional during startup
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

module.exports = router;
