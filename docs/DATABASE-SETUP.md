# Настройка базы данных ReestrPro (Timeweb)

## Текущая архитектура

| Компонент | Где хранится | Статус на проде |
|-----------|--------------|-----------------|
| **PostgreSQL** — заказы, рейсы, расходы, финансы | Облачная БД Timeweb `186.246.12.45` | ✅ Подключена (`db_connected: true`) |
| **Фото ТТН, документы** | Должны быть в **S3** | ⚠️ Сейчас `/tmp` — теряются при redeploy |
| **ZIP-бэкапы** | `DATA_DIR/backups` + **S3** | ⚠️ S3 не настроен |

> **Важно:** Timeweb App Platform **не поддерживает постоянные Volume** в docker-compose.  
> Папка `/data` на проде фактически = `/tmp/reestrpro-data` — всё локальное **сбрасывается** при пересборке.

**Вывод:** PostgreSQL уже настроена. Нужно настроить **S3** для файлов и бэкапов.

---

## Шаг 1. PostgreSQL (уже работает)

Переменные в ReestrPro Backend:

```env
DB_HOST=186.246.12.45
DB_PORT=5432
DB_NAME=default_db
DB_USER=gen_user
DB_PASSWORD=<из панели Timeweb → Базы данных>
DATABASE_SSL=true
DB_CONNECT_TIMEOUT_SEC=15
DB_FAST_STARTUP=false
```

Проверка: https://armen4ik15-creator-transport-app-server-26b3.twc1.net/api/health  
→ `"db_connected": true`, `"db_kind": "postgres"`

Если `db_connected: false` — сбросьте пароль `gen_user` в панели БД и обновите `DB_PASSWORD` → Пересобрать.

---

## Шаг 2. S3 Timeweb (обязательно для фото и бэкапов)

1. https://timeweb.cloud/my/storage/create  
2. Создайте бакет, например `reestrpro-data`  
3. Создайте **ключи доступа** (Access Key + Secret Key)  
4. В **ReestrPro Backend → Переменные окружения** добавьте:

```env
S3_ENDPOINT=https://s3.timeweb.cloud
S3_REGION=ru-1
S3_BUCKET=reestrpro-data
S3_ACCESS_KEY=ваш_access_key
S3_SECRET_KEY=ваш_secret_key
S3_PREFIX=reestrpro/backups/
S3_UPLOADS_PREFIX=uploads/

BACKUP_ENABLED=true
BACKUP_INTERVAL_HOURS=6
BACKUP_KEEP_LOCAL=14
BACKUP_KEEP_DAYS=7
BACKUP_CRON_SCHEDULE=0 3 * * *
BACKUP_RESTORE_CODE=ваш_секретный_код
MOBILE_APP_VERSION=1.5.2
MOBILE_APP_VERSION_CODE=37
```

5. **Пересобрать** приложение

После этого:
- каждое фото ТТН **дублируется в S3** (`uploads/trips/...`)
- превью и скачивание работают даже после redeploy
- ZIP-бэкапы уходят в S3 (`reestrpro/backups/...`)

---

## Шаг 3. Первый бэкап базы

В приложении (админ): **Ещё → Резервные копии → Создать резервную копию**

Или с сервера:
```bash
node scripts/backup-full.js
```

В архиве:
- `database/json/*.json` — все таблицы PostgreSQL
- `database/database.sql` — если доступен `pg_dump`
- `uploads/` — локальные файлы (после S3 — копии уже в облаке)

---

## Шаг 4. Проверка

```bash
node scripts/setup-production-check.js
```

Или вручную откройте `/api/health`:

```json
"storage": {
  "ephemeral_disk": true,
  "remote": { "s3": true, "s3_uploads": true },
  "warnings": []
}
```

---

## Восстановление

```bash
node scripts/restore-full.js /path/to/reestrpro-backup-....zip
```

PostgreSQL: `psql` с connection string из панели Timeweb.

---

## Что входит в бэкап БД

Заказы, рейсы, расходы, финансы, зарплаты, контрагенты, водители, путевые листы, счета, журнал действий, справочники.

Excel-экспорты из приложения — дополнительная выгрузка, не замена полному ZIP.
