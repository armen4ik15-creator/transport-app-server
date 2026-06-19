const express = require('express');
const fs = require('fs');
const db = require('../database');
const { DB_PATH, DATA_DIR } = require('../config/paths');
const { buildConnectionString, getPostgresEnvDiagnostics } = require('../database/connection');

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
  const payload = {
    status: 'ok',
    app_version: process.env.APP_VERSION || '1.2.1',
    db_kind: db.kind || 'sqlite',
    data_dir: DATA_DIR,
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
