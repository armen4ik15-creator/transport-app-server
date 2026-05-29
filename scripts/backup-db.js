/**
 * Creates a timestamped SQLite backup in /data/backups (or DATA_DIR/backups).
 * Run manually or via cron inside the container:
 *   node scripts/backup-db.js
 */
const fs = require('fs');
const path = require('path');
const { DB_PATH, DATA_DIR } = require('../config/paths');

function backupDatabase() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[backup] Database not found: ${DB_PATH}`);
    process.exit(1);
  }

  const backupDir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backupDir, `database-${stamp}.sqlite`);
  fs.copyFileSync(DB_PATH, target);
  console.log(`[backup] Saved ${target}`);
}

backupDatabase();
