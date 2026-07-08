const { getBackupConfig } = require('./backupConfig');
const { runFullBackup, isBackupRunning } = require('./backupService');
const db = require('../../database');

let intervalTimer = null;
let cronTask = null;

async function tick(trigger = 'scheduled') {
  if (isBackupRunning()) return;
  try {
    await runFullBackup({ trigger, userId: null, uploadRemote: true });
    console.log(`[backup] ${trigger} backup completed`);
  } catch (error) {
    console.error(`[backup] ${trigger} backup failed:`, error.message);
  }
}

function scheduleInterval() {
  if (intervalTimer) clearInterval(intervalTimer);
  const config = getBackupConfig();
  if (!config.enabled) return;

  const ms = Math.max(1, config.intervalHours) * 60 * 60 * 1000;
  intervalTimer = setInterval(() => {
    void tick('interval');
  }, ms);
}

function scheduleCron() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }

  const config = getBackupConfig();
  if (!config.enabled) return;

  try {
    const cron = require('node-cron');
    if (!cron.validate(config.cronSchedule)) {
      console.warn(`[backup] invalid cron schedule: ${config.cronSchedule}`);
      return;
    }
    cronTask = cron.schedule(config.cronSchedule, () => {
      void tick('cron');
    });
    console.log(`[backup] cron scheduler started (${config.cronSchedule})`);
  } catch (error) {
    console.warn('[backup] node-cron unavailable:', error.message);
  }
}

function startBackupScheduler() {
  if (db.kind === 'postgres_error') {
    console.log('[backup] scheduler skipped (database unavailable)');
    return;
  }
  const config = getBackupConfig();
  if (!config.enabled) {
    console.log('[backup] scheduler disabled');
    return;
  }
  scheduleInterval();
  scheduleCron();
  console.log(`[backup] interval scheduler started (every ${config.intervalHours}h)`);
}

function restartBackupScheduler() {
  scheduleInterval();
  scheduleCron();
}

module.exports = { startBackupScheduler, restartBackupScheduler, runBackupNow: tick };
