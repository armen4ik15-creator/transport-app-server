const {
  getYandexArchiveConfig,
  syncMonthlyReportsToYandex,
  syncAllTripPhotosToYandex,
  syncSalaryShiftsToYandex,
} = require('./yandexArchiveService');
const { shiftsDueOnCalendarDay } = require('../../utils/salaryShiftPeriods');

const STARTUP_DELAY_MS = Number(process.env.YANDEX_ARCHIVE_STARTUP_DELAY_MS || 15 * 60 * 1000);
const REPORTS_INTERVAL_MS = Number(
  process.env.YANDEX_ARCHIVE_REPORTS_INTERVAL_MS || 24 * 60 * 60 * 1000
);
const SALARY_CRON = process.env.YANDEX_ARCHIVE_SALARY_CRON || '0 3 * * *';

let started = false;
let running = false;
let salaryCronTask = null;

async function syncDueSalaryShifts(trigger = 'scheduled') {
  const due = shiftsDueOnCalendarDay();
  if (!due.length) return null;

  console.log(
    `[yandex-archive] ${trigger}: salary shifts due (${due.map((s) => s.title).join(', ')})`
  );
  const salary = await syncSalaryShiftsToYandex({ shifts: due });
  console.log(
    `[yandex-archive] ${trigger}: salary uploaded=${salary.uploaded?.length || 0}`
  );
  return salary;
}

async function tick(trigger = 'scheduled') {
  const config = getYandexArchiveConfig();
  if (!config.enabled || running) return;

  running = true;
  try {
    console.log(`[yandex-archive] ${trigger}: syncing monthly Excel reports...`);
    const reports = await syncMonthlyReportsToYandex({ months: 2 });
    console.log(
      `[yandex-archive] ${trigger}: reports done (${reports.uploaded?.length || 0} months)`
    );

    if (trigger === 'startup' || trigger === 'salary-cron') {
      await syncDueSalaryShifts(trigger);
    }

    if (trigger === 'startup' || process.env.YANDEX_ARCHIVE_SYNC_PHOTOS_ON_SCHEDULE === '1') {
      console.log(`[yandex-archive] ${trigger}: syncing TTN photos...`);
      const photos = await syncAllTripPhotosToYandex({ limit: 1000 });
      console.log(
        `[yandex-archive] ${trigger}: photos uploaded=${photos.uploaded} failed=${photos.failed}`
      );
    }
  } catch (error) {
    console.error(`[yandex-archive] ${trigger} failed:`, error.message);
  } finally {
    running = false;
  }
}

function startSalaryShiftCron() {
  try {
    const cron = require('node-cron');
    if (!cron.validate(SALARY_CRON)) {
      console.warn(`[yandex-archive] invalid salary cron: ${SALARY_CRON}`);
      return;
    }
    salaryCronTask = cron.schedule(SALARY_CRON, () => {
      const due = shiftsDueOnCalendarDay();
      if (!due.length) return;
      void tick('salary-cron');
    });
    console.log(
      `[yandex-archive] salary shift cron started (${SALARY_CRON}, days 15 & 30/last)`
    );
  } catch (error) {
    console.warn('[yandex-archive] salary cron unavailable:', error.message);
  }
}

function startYandexArchiveScheduler() {
  const config = getYandexArchiveConfig();
  if (!config.enabled) {
    console.log('[yandex-archive] scheduler skipped (token not configured)');
    return;
  }
  if (started) return;
  started = true;

  console.log(
    `[yandex-archive] scheduler started (first run in ${Math.round(STARTUP_DELAY_MS / 60000)} min)`
  );

  setTimeout(() => {
    void tick('startup');
  }, STARTUP_DELAY_MS);

  setInterval(() => {
    void tick('interval');
  }, REPORTS_INTERVAL_MS);

  startSalaryShiftCron();
}

module.exports = {
  startYandexArchiveScheduler,
  runYandexArchiveNow: tick,
  syncDueSalaryShifts,
};
