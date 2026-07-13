/**
 * One-shot sync: TTN photos + monthly Excel to Yandex Disk.
 *   node scripts/sync-yandex-archive.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../timeweb.env'), override: true });

async function main() {
  const {
    runYandexArchiveSync,
    getYandexArchiveConfig,
  } = require('../services/yandexArchive/yandexArchiveService');

  const config = getYandexArchiveConfig();
  if (!config.enabled) {
    console.error('[sync-yandex-archive] YANDEX_DISK_TOKEN missing');
    process.exit(1);
  }

  console.log(`[sync-yandex-archive] root=${config.root}`);
  const result = await runYandexArchiveSync({
    photos: true,
    reports: true,
    photoLimit: Number(process.env.YANDEX_ARCHIVE_PHOTO_LIMIT || 500),
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[sync-yandex-archive]', error);
  process.exit(1);
});
