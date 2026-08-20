const {
  getYandexArchiveConfig,
  syncMonthlyReportsToYandex,
  syncAllTripPhotosToYandex,
  syncDriverEarningsToYandex,
} = require('./yandexArchiveService');
const { shiftsDueOnCalendarDay } = require('../../utils/salaryShiftPeriods');

const STARTUP_DELAY_MS = Number(process.env.YANDEX_ARCHIVE_STARTUP_DELAY_MS || 15 * 60 * 1000);
const REPORTS_INTERVAL_MS = Number(
  process.env.YANDEX_ARCHIVE_REPORTS_INTERVAL_MS || 24 * 60 * 60 * 1000
);
/** Почасовая выгрузка фото ТТН на Яндекс.Диск (по умолчанию 1 час). */
const PHOTOS_INTERVAL_MS = Number(
  process.env.YANDEX_ARCHIVE_PHOTOS_INTERVAL_MS || 60 * 60 * 1000
);
const PHOTO_LIMIT = Number(process.env.YANDEX_ARCHIVE_PHOTO_LIMIT || 2000);
const EARNINGS_CRON = process.env.YANDEX_ARCHIVE_EARNINGS_CRON || '0 3 * * *';

let started = false;
let reportsRunning = false;
let photosRunning = false;
let earningsCronTask = null;

async function syncDueDriverEarnings(trigger = 'scheduled') {
  const due = shiftsDueOnCalendarDay();
  if (!due.length) return null;

  console.log(
    `[yandex-archive] ${trigger}: driver earnings due (${due.map((s) => s.title).join(', ')})`
  );
  const earnings = await syncDriverEarningsToYandex({ shifts: due });
  console.log(
    `[yandex-archive] ${trigger}: earnings uploaded=${earnings.uploaded?.length || 0}`
  );
  return earnings;
}

async function syncPhotosTick(trigger = 'photos') {
  const config = getYandexArchiveConfig();
  if (!config.enabled || photosRunning) return;

  photosRunning = true;
  try {
    console.log(`[yandex-archive] ${trigger}: syncing TTN photos...`);
    const photos = await syncAllTripPhotosToYandex({ limit: PHOTO_LIMIT });
    console.log(
      `[yandex-archive] ${trigger}: photos uploaded=${photos.uploaded} skipped=${photos.skipped || 0} failed=${photos.failed}`
    );
  } catch (error) {
    console.error(`[yandex-archive] ${trigger} photos failed:`, error.message);
  } finally {
    photosRunning = false;
  }
}

async function tick(trigger = 'scheduled') {
  const config = getYandexArchiveConfig();
  if (!config.enabled || reportsRunning) return;

  reportsRunning = true;
  try {
    console.log(`[yandex-archive] ${trigger}: syncing monthly Excel reports...`);
    const reports = await syncMonthlyReportsToYandex({ months: 2 });
    console.log(
      `[yandex-archive] ${trigger}: reports done (${reports.uploaded?.length || 0} months)`
    );

    if (trigger === 'startup' || trigger === 'earnings-cron') {
      await syncDueDriverEarnings(trigger);
    }

    // При старте сразу подтягиваем фото; дальше — отдельный часовой цикл.
    if (trigger === 'startup') {
      await syncPhotosTick('startup');
    }
  } catch (error) {
    console.error(`[yandex-archive] ${trigger} failed:`, error.message);
  } finally {
    reportsRunning = false;
  }
}

function startDriverEarningsCron() {
  try {
    const cron = require('node-cron');
    if (!cron.validate(EARNINGS_CRON)) {
      console.warn(`[yandex-archive] invalid earnings cron: ${EARNINGS_CRON}`);
      return;
    }
    earningsCronTask = cron.schedule(EARNINGS_CRON, () => {
      const due = shiftsDueOnCalendarDay();
      if (!due.length) return;
      void tick('earnings-cron');
    });
    console.log(
      `[yandex-archive] driver earnings cron started (${EARNINGS_CRON}, days 15 & 30/last)`
    );
  } catch (error) {
    console.warn('[yandex-archive] earnings cron unavailable:', error.message);
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
    `[yandex-archive] scheduler started (first run in ${Math.round(STARTUP_DELAY_MS / 60000)} min; photos every ${Math.round(PHOTOS_INTERVAL_MS / 60000)} min)`
  );

  setTimeout(() => {
    void tick('startup');
  }, STARTUP_DELAY_MS);

  setInterval(() => {
    void tick('interval');
  }, REPORTS_INTERVAL_MS);

  setInterval(() => {
    void syncPhotosTick('hourly');
  }, PHOTOS_INTERVAL_MS);

  startDriverEarningsCron();
}

module.exports = {
  startYandexArchiveScheduler,
  runYandexArchiveNow: tick,
  syncDueDriverEarnings,
  syncPhotosTick,
};
