/**
 * Проверка продакшена: PostgreSQL, хранилище, S3.
 * Usage: node scripts/setup-production-check.js [healthUrl]
 */
const DEFAULT_HEALTH_URL =
  'https://armen4ik15-creator-transport-app-server-26b3.twc1.net/api/health';

async function main() {
  const healthUrl = process.argv[2] || DEFAULT_HEALTH_URL;
  console.log(`[setup] GET ${healthUrl}`);

  const response = await fetch(healthUrl);
  const data = await response.json();

  console.log('\n=== PostgreSQL ===');
  console.log('db_kind:', data.db_kind);
  console.log('db_connected:', data.db_connected);
  if (data.db_error) console.log('db_error:', data.db_error);

  const storage = data.storage || {};
  console.log('\n=== Хранилище ===');
  console.log('data_dir:', storage.data_dir);
  console.log('ephemeral_disk:', storage.ephemeral_disk);
  console.log('uploads_file_count:', storage.uploads_file_count);
  console.log('backup_file_count:', storage.backup_file_count);
  console.log('S3 backups:', storage.remote?.s3);
  console.log('S3 uploads:', storage.remote?.s3_uploads);

  if (storage.warnings?.length) {
    console.log('\n=== ⚠️ Предупреждения ===');
    storage.warnings.forEach((w) => console.log('-', w));
  }

  console.log('\n=== Рекомендации ===');
  if (data.db_connected !== true) {
    console.log('1. Проверьте DB_PASSWORD в Timeweb → Пересобрать');
  } else {
    console.log('1. ✅ PostgreSQL подключена');
  }

  if (!storage.remote?.s3) {
    console.log('2. ❌ Настройте S3 (см. docs/DATABASE-SETUP.md шаг 2)');
  } else {
    console.log('2. ✅ S3 настроен');
  }

  if (storage.ephemeral_disk) {
    console.log('3. ⚠️ Локальный диск временный — полагайтесь на S3 для фото и бэкапов');
  }

  if ((storage.backup_file_count || 0) === 0) {
    console.log('4. Запустите первый бэкап: Ещё → Резервные копии → Создать');
  } else {
    console.log('4. ✅ Локальные бэкапы есть (дублируйте в S3)');
  }

  console.log('\nПодробно: server/docs/DATABASE-SETUP.md');
}

main().catch((error) => {
  console.error('[setup] FAILED', error.message);
  process.exit(1);
});
