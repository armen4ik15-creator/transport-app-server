# Резервное копирование ReestrPro

## Что сохраняется

Каждый бэкап — ZIP-архив:

| Содержимое | Описание |
|------------|----------|
| `database/` | SQLite или PostgreSQL dump (`.sql`) + JSON-экспорт всех таблиц |
| `uploads/` | Все ТТН, фото заказов, документы, путевые листы |
| `manifest.json` | Метаданные: дата, размер, количество файлов |

**Включены:** заказы, рейсы, расходы, финансы, зарплаты, оплаты контрагентам, журнал действий, справочники.

## Где хранится

1. **На сервере** — `DATA_DIR/backups/` (последние 14 копий по умолчанию)
2. **S3** — облачное хранилище (основной off-site)
3. **Webhook / Telegram** — уведомления о каждом бэкапе

> **Важно:** в `docker-compose.yml` смонтирован volume `app-data:/data` — без него uploads и локальные бэкапы теряются при redeploy контейнера.

## Настройка (Timeweb App Platform)

### 0. Постоянный диск `/data` (обязательно)

Без volume при каждом redeploy теряются:

- `uploads/` — все фото ТТН, расходов, документов
- `backups/` — локальные ZIP-архивы

**В панели Timeweb → приложение ReestrPro Backend:**

1. Раздел **Volumes** → создать volume (минимум 5–10 GB)
2. Смонтировать в контейнер по пути **`/data`**
3. В переменных окружения: `DATA_DIR=/data`
4. Пересобрать приложение

Проверка после деплоя: `GET /api/health` → `storage.data_dir_writable: true`, `storage.uploads_file_count > 0` после загрузки фото.

Для Docker Compose на VPS в репозитории уже есть `volumes: app-data:/data`.

### 1. S3-хранилище Timeweb (off-site, обязательно для production)

1. Создайте бакет в панели Timeweb → S3
2. Добавьте переменные в деплой:

```env
BACKUP_S3_ENDPOINT=https://s3.timeweb.cloud
BACKUP_S3_REGION=ru-1
BACKUP_S3_BUCKET=ваш-бакет
BACKUP_S3_ACCESS_KEY=...
BACKUP_S3_SECRET_KEY=...
BACKUP_S3_PREFIX=reestrpro/
```

### 2. Автоматический режим

```env
BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=6
BACKUP_KEEP_LOCAL=14
```

После деплоя бэкап запускается каждые 6 часов автоматически.

### 3. Ручной бэкап (SSH / контейнер)

```bash
node scripts/backup-full.js
```

## API (только admin)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/backups/status` | Статус, последний бэкап, настройки remote |
| GET | `/api/backups` | Список локальных архивов |
| POST | `/api/backups/run` | Запустить бэкап сейчас |
| GET | `/api/backups/download/:filename` | Скачать ZIP |

## Мобильное приложение

**Ещё → Резервные копии** — просмотр статуса, запуск бэкапа, скачивание архива на телефон.

## Восстановление

1. Скачайте ZIP через приложение (**Ещё → Резервные копии**) или из S3
2. На сервере (контейнер остановлен или в maintenance):

```bash
node scripts/restore-full.js /path/to/reestrpro-backup-....zip
```

3. Скрипт распакует `uploads/` в `DATA_DIR/uploads/` и восстановит SQLite (или `database.sql` для PostgreSQL через `psql`)
4. Перезапустите приложение

Ручной вариант:

1. Распакуйте ZIP
2. Для PostgreSQL: `psql $DATABASE_URL -f database/database.sql`
3. Скопируйте `uploads/` в `DATA_DIR/uploads/` на сервере

> Полное восстановление на production — только администратором. Перед restore остановите приложение.

## Что уже входит в бэкап (полная база)

| Данные | Где в архиве |
|--------|----------------|
| Заказы, рейсы, ТТН | `database/` (SQL или JSON) |
| Расходы, финансы, зарплаты | `database/` |
| Путевые листы, счета, документы | `database/` + `uploads/` |
| Фото ТТН, чеки расходов | `uploads/trips/`, `uploads/expenses/` |
| Журнал действий, справочники | `database/` |

Excel-экспорты из приложения — дополнительная точечная выгрузка, не замена полному ZIP.
