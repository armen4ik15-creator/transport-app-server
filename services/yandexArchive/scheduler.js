const {
  getYandexArchiveConfig,
  syncMonthlyReportsToYandex,
  syncAllTripPhotosToYandex,
} = require('./yandexArchiveService');

const STARTUP_DELAY_MS = Number(process.env.YANDEX_ARCHIVE_STARTUP_DELAY_MS || 15 * 60 * 1000);
const REPORTS_INTERVAL_MS = Number(
  process.env.YANDEX_ARCHIVE_REPORTS_INTERVAL_MS || 24 * 60 * 60 * 1000
);

let started = false;
let running = false;

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
}

module.exports = {
  startYandexArchiveScheduler,
  runYandexArchiveNow: tick,
};
