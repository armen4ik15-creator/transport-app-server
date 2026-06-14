/**
 * Legacy SQLite-only backup. On PostgreSQL production use: npm run backup
 */
require('dotenv').config();
const { isPostgresEnabled } = require('../database/connection');

if (isPostgresEnabled()) {
  console.log('[backup-db] PostgreSQL detected — use: npm run backup (full ZIP)');
  require('./backup-full.js');
} else {
  const fs = require('fs');
  const path = require('path');
  const { DB_PATH, DATA_DIR } = require('../config/paths');

  if (!fs.existsSync(DB_PATH)) {
    console.error(`[backup] Database not found: ${DB_PATH}`);
    process.exit(1);
  }

  const backupDir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `database-${stamp}.sqlite`);
  fs.copyFileSync(DB_PATH, target);
  console.log(`[backup] Saved ${target}`);
}
