const express = require('express');
const fs = require('fs');
const { DB_PATH, DATA_DIR } = require('../config/paths');

const router = express.Router();

router.get('/', (_req, res) => {
  return res.json({
    status: 'ok',
    data_dir: DATA_DIR,
    db_path: DB_PATH,
    db_exists: fs.existsSync(DB_PATH),
  });
});

module.exports = router;
