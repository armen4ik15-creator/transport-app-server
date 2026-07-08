# Настройка резервного копирования на Timeweb

Полное резервное копирование ReestrPro включает:

- **PostgreSQL** — все таблицы (заказы, рейсы, расходы, финансы, зарплаты, реестры)
- **uploads/** — фото ТТН, чеки расходов, документы, путевые листы, счета

Архивы сохраняются на постоянном диске `/data` и (при настройке) дублируются в S3.

---

## Шаг 1. Постоянный диск (Volume)

1. Откройте [Timeweb Cloud](https://timeweb.cloud) → **Приложения** → **ReestrPro Backend**
2. Вкладка **Диски** (Volumes)
3. **Создать диск** — 10 ГБ
4. **Примонтировать** к пути **`/data`**
5. В переменных окружения добавьте:

```env
DATA_DIR=/data
```

6. Нажмите **Пересобрать**

### Проверка

Откройте в браузере:

```
https://armen4ik15-creator-transport-app-server-26b3.twc1.net/api/health
```

Должно быть:

```json
"storage": {
  "data_dir_writable": true,
  ...
}
```

---

## Шаг 2. S3-хранилище (облачный бэкап)

1. Перейдите: https://timeweb.cloud/my/storage/create
2. Создайте бакет, например `reestrpro-backups`
3. Создайте ключи доступа (Access Key + Secret Key)
4. В **ReestrPro Backend** → **Переменные окружения** добавьте:

```env
S3_ENDPOINT=https://s3.timeweb.cloud
S3_REGION=ru-1
S3_BUCKET=reestrpro-backups
S3_ACCESS_KEY=ваш_ключ
S3_SECRET_KEY=ваш_секрет
S3_PREFIX=reestrpro/
```

> Поддерживаются и старые имена `BACKUP_S3_*` — можно использовать любой вариант.

5. **Пересобрать** приложение

### Дополнительные переменные (рекомендуется)

```env
BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=6
BACKUP_KEEP_LOCAL=14
BACKUP_KEEP_DAYS=7
BACKUP_CRON_SCHEDULE=0 3 * * *
BACKUP_RESTORE_CODE=ваш_секретный_код_восстановления
```

- `BACKUP_CRON_SCHEDULE=0 3 * * *` — ежедневный бэкап в 03:00
- `BACKUP_KEEP_DAYS=7` — удалять локальные архивы старше 7 дней

---

## Шаг 3. Проверка из приложения

1. Войдите как **администратор**
2. **Ещё** → **Резервные копии**
3. Нажмите **Создать резервную копию сейчас**
4. Через 1–2 минуты обновите список — должен появиться архив `reestrpro-backup-....zip`
5. В manifest должно быть `uploads.file_count > 0` (после того как есть загруженные файлы)
6. В панели Timeweb → S3 → бакет — проверьте, что ZIP появился в папке `reestrpro/`

---

## Шаг 4. Восстановление при аварии

### С сервера (SSH / консоль контейнера)

```bash
node scripts/restore-full.js /data/backups/reestrpro-backup-YYYY-MM-DD....zip
```

### Через API (только admin)

```http
POST /api/backups/restore/reestrpro-backup-....zip
Content-Type: application/json

{ "confirmCode": "ваш_BACKUP_RESTORE_CODE" }
```

После восстановления **перезапустите** приложение на Timeweb.

---

## Что уже работает автоматически

| Механизм | Описание |
|----------|----------|
| Интервал | Каждые 6 ч. (`BACKUP_INTERVAL_HOURS`) |
| Cron | Ежедневно в 03:00 (`BACKUP_CRON_SCHEDULE`) |
| S3 upload | После каждого бэкапа |
| Очистка | Архивы старше 7 дней и сверх лимита 14 шт. |
| Мобильное приложение | Экран «Резервные копии» — запуск и скачивание |

---

## Внешний cron (если контейнер часто перезапускается)

В Timeweb можно настроить **Cron-задачу**:

```bash
curl -X POST "https://armen4ik15-creator-transport-app-server-26b3.twc1.net/api/backups/run" \
  -H "Authorization: Bearer <admin_token>"
```

Рекомендуется раз в сутки в 03:00 как дополнительная страховка.
