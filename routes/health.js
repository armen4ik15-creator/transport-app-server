const express = require('express');
const fs = require('fs');
const db = require('../database');
const { DB_PATH, DATA_DIR } = require('../config/paths');
const { buildConnectionString } = require('../database/connection');

const router = express.Router();

router.get('/', (_req, res) => {
  const payload = {
    status: 'ok',
    db_kind: db.kind || 'sqlite',
    data_dir: DATA_DIR,
  };

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
    return res.json(payload);
  }

  payload.db_path = DB_PATH;
  payload.db_exists = fs.existsSync(DB_PATH);
  return res.json(payload);
});

module.exports = router;
