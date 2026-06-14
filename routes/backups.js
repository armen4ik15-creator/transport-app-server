const express = require('express');
const fs = require('fs');
const path = require('path');
const { authMiddleware } = require('../middleware/auth');
const { getBackupConfig } = require('../services/backup/backupConfig');
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

router.get('/status', requireAdmin, (_req, res) => {
  return res.json(getBackupStatus());
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
    return res.status(201).json(result);
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

module.exports = router;
