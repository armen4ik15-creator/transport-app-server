const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { authMiddleware } = require('../middleware/auth');
const { getBackupConfig } = require('../services/backup/backupConfig');
const { createS3Client, listS3Objects } = require('../config/s3');
const {
  runFullBackup,
  getBackupStatus,
  resolveBackupFile,
  isBackupRunning,
} = require('../services/backup/backupService');

const router = express.Router();
router.use(authMiddleware);

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Доступ только для администратора' });
  }
  return next();
}

router.get('/status', requireAdmin, async (_req, res) => {
  const status = getBackupStatus();
  const config = getBackupConfig();
  let s3Backups = [];

  if (config.s3.enabled) {
    try {
      const client = createS3Client(config.s3);
      if (client) {
        s3Backups = await listS3Objects({
          client,
          bucket: config.s3.bucket,
          prefix: config.s3.prefix,
        });
      }
    } catch (error) {
      s3Backups = [{ error: error.message }];
    }
  }

  return res.json({
    ...status,
    keepLocalDays: config.keepLocalDays,
    cronSchedule: config.cronSchedule,
    storage: require('../utils/storageHealth').getStorageHealth(),
    s3Backups,
  });
});

router.get('/list', requireAdmin, async (_req, res) => {
  const status = getBackupStatus();
  const config = getBackupConfig();
  let s3Backups = [];

  if (config.s3.enabled) {
    try {
      const client = createS3Client(config.s3);
      if (client) {
        s3Backups = await listS3Objects({
          client,
          bucket: config.s3.bucket,
          prefix: config.s3.prefix,
        });
      }
    } catch (error) {
      s3Backups = [];
    }
  }

  return res.json({
    local: status.backups,
    s3: s3Backups,
  });
});

router.get('/', requireAdmin, (_req, res) => {
  const config = getBackupConfig();
  return res.json(getBackupStatus().backups);
});

router.post('/run', requireAdmin, async (req, res) => {
  if (isBackupRunning()) {
    return res.status(409).json({ error: 'Резервное копирование уже выполняется' });
  }

  const uploadRemote = req.body?.uploadRemote !== false;
  try {
    const result = await runFullBackup({
      trigger: 'manual',
      userId: req.user.id,
      uploadRemote,
    });
    return res.status(201).json({
      ...result,
      jobId: result.filename,
      message: 'Резервная копия создана',
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Backup failed' });
  }
});

router.get('/download/:filename', requireAdmin, (req, res) => {
  try {
    const config = getBackupConfig();
    const filePath = resolveBackupFile(config.backupDir, req.params.filename);
    const stat = fs.statSync(filePath);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(filePath).pipe(res);
    return undefined;
  } catch (error) {
    return res.status(404).json({ error: error.message || 'Backup not found' });
  }
});

router.post('/restore/:filename', requireAdmin, (req, res) => {
  const config = getBackupConfig();
  const confirmCode = String(req.body?.confirmCode || '');
  if (!config.restoreCode || confirmCode !== config.restoreCode) {
    return res.status(403).json({ error: 'Неверный код подтверждения восстановления' });
  }

  try {
    const archivePath = resolveBackupFile(config.backupDir, req.params.filename);
    const scriptPath = path.join(__dirname, '..', 'scripts', 'restore-full.js');
    const result = spawnSync(process.execPath, [scriptPath, archivePath], {
      encoding: 'utf8',
      timeout: 600000,
    });

    if (result.status !== 0) {
      return res.status(500).json({
        error: result.stderr || result.stdout || 'Restore failed',
      });
    }

    return res.json({
      ok: true,
      message: 'Восстановление завершено. Перезапустите приложение на Timeweb.',
      filename: path.basename(archivePath),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Restore failed' });
  }
});

module.exports = router;
