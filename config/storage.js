const path = require('path');
const { DATA_DIR, UPLOADS_DIR, ensureDataStorage } = require('./paths');

const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function ensureStorageDirectories() {
  ensureDataStorage();
  const fs = require('fs');
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

module.exports = {
  DATA_DIR,
  UPLOADS_DIR,
  BACKUP_DIR,
  ensureStorageDirectories,
};
