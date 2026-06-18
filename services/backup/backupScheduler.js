const { getBackupConfig } = require('./backupConfig');
const { runFullBackup, isBackupRunning } = require('./backupService');
const db = require('../../database');

let timer = null;

async function tick() {
  if (isBackupRunning()) return;
  try {
    await runFullBackup({ trigger: 'scheduled', userId: null, uploadRemote: true });
    console.log('[backup] scheduled backup completed');
  } catch (error) {
    console.error('[backup] scheduled backup failed:', error.message);
  }
}

function scheduleNext() {
  if (timer) clearInterval(timer);
  const config = getBackupConfig();
  if (!config.enabled) return;

  const ms = Math.max(1, config.intervalHours) * 60 * 60 * 1000;
  timer = setInterval(() => {
    void tick();
  }, ms);
}

function startBackupScheduler() {
  const config = getBackupConfig();
  if (!config.enabled) {
    console.log('[backup] scheduler disabled');
    return;
  }
  scheduleNext();
  console.log(`[backup] scheduler started (every ${config.intervalHours}h)`);
}

function restartBackupScheduler() {
  scheduleNext();
}

module.exports = { startBackupScheduler, restartBackupScheduler, runBackupNow: tick };
