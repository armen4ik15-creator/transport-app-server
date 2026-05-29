const fs = require('fs');
const path = require('path');

function resolveDataDir() {
  if (process.env.DATA_DIR) {
    return path.resolve(process.env.DATA_DIR);
  }
  if (fs.existsSync('/data')) {
    return '/data';
  }
  return path.join(__dirname, '..');
}

const DATA_DIR = resolveDataDir();
const DB_PATH = path.join(DATA_DIR, 'database.sqlite');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const LEGACY_DB_PATH = path.join(__dirname, '..', 'data.sqlite');
const LEGACY_UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureDataStorage() {
  ensureDir(DATA_DIR);
  ensureDir(UPLOADS_DIR);

  if (!fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
    console.log(`[data] Legacy database copied to ${DB_PATH}`);
  }

  if (fs.existsSync(LEGACY_UPLOADS_DIR)) {
    const entries = fs.readdirSync(LEGACY_UPLOADS_DIR, { withFileTypes: true });
    entries.forEach((entry) => {
      const from = path.join(LEGACY_UPLOADS_DIR, entry.name);
      const to = path.join(UPLOADS_DIR, entry.name);
      if (entry.isDirectory()) {
        ensureDir(to);
      } else if (!fs.existsSync(to)) {
        fs.copyFileSync(from, to);
      }
    });
  }
}

function uploadsSubdir(name) {
  const dir = path.join(UPLOADS_DIR, name);
  ensureDir(dir);
  return dir;
}

module.exports = {
  DATA_DIR,
  DB_PATH,
  UPLOADS_DIR,
  ensureDataStorage,
  uploadsSubdir,
};
