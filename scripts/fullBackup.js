/**
 * Full backup alias: database + uploads + manifest (ZIP).
 * Usage: node scripts/fullBackup.js
 */
require('dotenv').config();
require('../database');
const { runFullBackup } = require('../services/backup/backupService');

runFullBackup({ trigger: 'cli', userId: null, uploadRemote: true })
  .then((result) => {
    console.log('[backup] OK', result.filename, `${Math.round(result.sizeBytes / 1024 / 1024)} MB`);
    process.exit(0);
  })
  .catch((error) => {
    console.error('[backup] FAILED', error.message);
    process.exit(1);
  });
