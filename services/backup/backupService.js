const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../../database');
const { logActivity } = require('../../utils/activity');
const { getBackupConfig } = require('./backupConfig');
const { exportDatabaseAsync } = require('./backupDatabase');
const { createBackupZip, prepareStagingDirectory } = require('./backupArchiver');
const { uploadBackupRemote } = require('./backupRemote');

let running = false;
let lastResult = null;

function safeRemoveDir(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function pruneLocalBackups(backupDir, keepCount, keepDays = 7) {
  if (!fs.existsSync(backupDir)) return;

  const now = Date.now();
  const maxAgeMs = keepDays * 24 * 60 * 60 * 1000;

  const files = fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith('reestrpro-backup-') && name.endsWith('.zip'))
    .map((name) => {
      const filePath = path.join(backupDir, name);
      const stat = fs.statSync(filePath);
      return {
        name,
        mtime: stat.mtimeMs,
        ageMs: now - stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const toDelete = new Set();

  files.slice(keepCount).forEach(({ name }) => toDelete.add(name));
  files.forEach(({ name, ageMs }) => {
    if (ageMs > maxAgeMs) toDelete.add(name);
  });

  toDelete.forEach((name) => {
    fs.unlinkSync(path.join(backupDir, name));
    const manifestPath = path.join(backupDir, `${name}.manifest.json`);
    if (fs.existsSync(manifestPath)) {
      fs.unlinkSync(manifestPath);
    }
  });
}

function listLocalBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith('reestrpro-backup-') && name.endsWith('.zip'))
    .map((name) => {
      const filePath = path.join(backupDir, name);
      const stat = fs.statSync(filePath);
      let manifest = null;
      const manifestPath = path.join(backupDir, `${name}.manifest.json`);
      if (fs.existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch {
          manifest = null;
        }
      }
      return {
        filename: name,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        manifest,
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

async function runFullBackup({ trigger = 'manual', userId = null, uploadRemote = true } = {}) {
  if (running) {
    throw new Error('Резервное копирование уже выполняется');
  }

  const config = getBackupConfig();
  if (!config.enabled) {
    throw new Error('Резервное копирование отключено (BACKUP_ENABLED=false)');
  }

  running = true;
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, '-');
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reestrpro-backup-'));
  const filename = `reestrpro-backup-${stamp}.zip`;
  const zipPath = path.join(config.backupDir, filename);

  try {
    fs.mkdirSync(config.backupDir, { recursive: true });

    const { dbDir, uploadsFileCount, uploadsSizeBytes } = prepareStagingDirectory(stagingDir);
    const dbExport = await exportDatabaseAsync(dbDir);

    const manifest = {
      version: 1,
      app: 'ReestrPro',
      created_at: startedAt,
      trigger,
      db_kind: db.kind || 'sqlite',
      database: dbExport,
      uploads: {
        file_count: uploadsFileCount,
        size_bytes: uploadsSizeBytes,
      },
      includes: [
        'orders',
        'trips',
        'order_photos',
        'expenses',
        'finances',
        'salary',
        'contractor_payments',
        'activity_log',
        'documents',
        'waybills',
        'invoices',
        'uploads',
      ],
    };

    const zipSize = await createBackupZip({ stagingDir, zipPath, manifest });
    const manifestSidecar = `${zipPath}.manifest.json`;
    fs.writeFileSync(manifestSidecar, JSON.stringify(manifest, null, 2), 'utf8');

    const backupMeta = {
      filename,
      filePath: zipPath,
      sizeBytes: zipSize,
      createdAt: startedAt,
      manifest,
    };

    let remote = null;
    if (uploadRemote) {
      remote = await uploadBackupRemote(config, backupMeta);
    }

    pruneLocalBackups(config.backupDir, config.keepLocalCount, config.keepLocalDays);

    const result = {
      ok: true,
      filename,
      sizeBytes: zipSize,
      createdAt: startedAt,
      trigger,
      database: dbExport,
      uploadsFileCount,
      remote,
      downloadPath: `/api/backups/download/${encodeURIComponent(filename)}`,
    };

    lastResult = result;
    logActivity(userId, 'backup.completed', {
      filename,
      sizeBytes: zipSize,
      trigger,
      remote,
    });

    return result;
  } catch (error) {
    lastResult = {
      ok: false,
      createdAt: startedAt,
      trigger,
      error: error.message,
    };
    logActivity(userId, 'backup.failed', { trigger, error: error.message });
    throw error;
  } finally {
    safeRemoveDir(stagingDir);
    running = false;
  }
}

function getBackupStatus() {
  const config = getBackupConfig();
  const backups = listLocalBackups(config.backupDir);
  return {
    enabled: config.enabled,
    running,
    intervalHours: config.intervalHours,
    keepLocalCount: config.keepLocalCount,
    remote: {
      s3: config.s3.enabled,
      yandex: config.yandexDisk.enabled,
      webhook: Boolean(config.webhookUrl),
      telegram: Boolean(config.telegram.botToken && config.telegram.chatId),
    },
    lastResult,
    latest: backups[0] ?? null,
    backups,
  };
}

function resolveBackupFile(backupDir, filename) {
  const safeName = path.basename(filename);
  if (!safeName.startsWith('reestrpro-backup-') || !safeName.endsWith('.zip')) {
    throw new Error('Invalid backup filename');
  }
  const filePath = path.join(backupDir, safeName);
  if (!fs.existsSync(filePath)) {
    throw new Error('Backup not found');
  }
  return filePath;
}

module.exports = {
  runFullBackup,
  getBackupStatus,
  listLocalBackups,
  resolveBackupFile,
  isBackupRunning: () => running,
};
