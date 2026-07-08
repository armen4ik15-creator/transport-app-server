/**
 * Восстановление из ZIP-бэкапа ReestrPro (database + uploads).
 *
 * Usage:
 *   node scripts/restore-full.js path/to/reestrpro-backup-....zip
 *
 * Перед восстановлением остановите приложение.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { DATA_DIR, UPLOADS_DIR, DB_PATH } = require('../config/paths');
const { buildConnectionString, isPostgresEnabled } = require('../database/connection');

function extractZip(archivePath, destination) {
  fs.mkdirSync(destination, { recursive: true });

  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destination}' -Force`],
      { encoding: 'utf8' }
    );
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'Expand-Archive failed');
    }
    return;
  }

  const result = spawnSync('unzip', ['-o', archivePath, '-d', destination], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'unzip failed');
  }
}

function copyDirectoryRecursive(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(destination, { recursive: true });
  const entries = fs.readdirSync(source, { withFileTypes: true });
  entries.forEach((entry) => {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  });
}

function restoreDatabase(dbDir) {
  const sqlFile = path.join(dbDir, 'database.sql');
  const sqliteFile = path.join(dbDir, 'database.sqlite');

  if (isPostgresEnabled()) {
    if (!fs.existsSync(sqlFile)) {
      console.warn('[restore] PostgreSQL: database.sql not found — use JSON export manually if needed');
      return { kind: 'postgres_skipped' };
    }
    const connectionString = buildConnectionString();
    if (!connectionString) {
      throw new Error('PostgreSQL connection string is not configured');
    }
    const result = spawnSync('psql', [connectionString, '-f', sqlFile], {
      encoding: 'utf8',
      timeout: 300000,
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || 'psql restore failed');
    }
    return { kind: 'postgres_sql', file: sqlFile };
  }

  if (!fs.existsSync(sqliteFile)) {
    throw new Error(`SQLite backup not found: ${sqliteFile}`);
  }
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.copyFileSync(sqliteFile, DB_PATH);
  return { kind: 'sqlite', file: DB_PATH };
}

function main() {
  const archivePath = path.resolve(process.argv[2] || '');
  if (!archivePath || !fs.existsSync(archivePath)) {
    console.error('Usage: node scripts/restore-full.js <backup.zip>');
    process.exit(1);
  }

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reestrpro-restore-'));
  console.log(`[restore] Extracting to ${stagingDir}`);
  extractZip(archivePath, stagingDir);

  const manifestPath = path.join(stagingDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    console.log('[restore] Manifest created_at:', manifest.created_at);
    console.log('[restore] Includes:', (manifest.includes || []).join(', '));
  }

  const uploadsSource = path.join(stagingDir, 'uploads');
  if (fs.existsSync(uploadsSource)) {
    console.log(`[restore] Restoring uploads -> ${UPLOADS_DIR}`);
    copyDirectoryRecursive(uploadsSource, UPLOADS_DIR);
  } else {
    console.warn('[restore] uploads/ not found in archive');
  }

  const dbDir = path.join(stagingDir, 'database');
  if (fs.existsSync(dbDir)) {
    const dbResult = restoreDatabase(dbDir);
    console.log('[restore] Database:', dbResult);
  } else {
    console.warn('[restore] database/ not found in archive');
  }

  console.log('[restore] Done. Restart the application.');
}

try {
  main();
} catch (error) {
  console.error('[restore] FAILED', error.message);
  process.exit(1);
}
