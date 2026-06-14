# Интеграция топливных карт Opti (opti.ru)

## Идея

Водитель заправляется по карте Opti → сервер получает транзакцию → автоматически создаётся расход `exp_type=fuel` → данные попадают в финансовые отчёты и P&L.

Пока API Opti недоступен, используется **MockFuelDataSource**. Переключение на реальный API — только замена реализации источника.

## Архитектура

```
FuelDataSource (интерфейс)
├── MockFuelDataSource   — имитация заправок
└── OptiApiDataSource    — заглушка → реализовать при получении API

fuelSyncService.runFuelSync()
  → fetchRecentTransactions()
  → дедупликация (external_id + fingerprint)
  → INSERT expenses (fuel, noncash)
  → INSERT fuel_transactions
```

## Таблицы БД

| Таблица | Назначение |
|---------|------------|
| `fuel_cards` | Привязка номера карты к водителю |
| `fuel_transactions` | Импортированные заправки + `expense_id` |
| `fuel_settings` | Источник (mock/opti), учётные данные, статус синхронизации |
| `fuel_sync_logs` | Журнал попыток синхронизации |

Поле `raw_payload` в `fuel_transactions` — JSON для дополнительных полей Opti.

## API

| Метод | Путь | Доступ |
|-------|------|--------|
| GET | `/api/fuel/sync-status` | admin, driver |
| GET | `/api/fuel/transactions` | admin (все), driver (свои) |
| GET/PUT | `/api/fuel/settings` | admin |
| POST | `/api/fuel/sync` | admin |
| POST | `/api/fuel/test-connection` | admin |
| GET/POST/PUT/DELETE | `/api/fuel/cards` | admin |

## Как подключить реальный Opti API

1. Получите документацию API и задайте `OPTI_API_BASE_URL` в `.env`.
2. Откройте `server/services/fuel/OptiApiDataSource.js`.
3. Реализуйте:
   - `authenticate()` — токен по `opti_login` / `opti_password`
   - `fetchRecentTransactions(cards, since)` — список транзакций
4. Маппинг ответа Opti → объект:

```javascript
{
  external_id: '...',      // уникальный ID от Opti (обязательно!)
  card_number: '...',
  transaction_at: '2026-06-04 14:30:00',
  station_name: 'АЗС ...',
  amount: 4500,
  liters: 72.5,
  raw_payload: { /* полный ответ Opti */ },
}
```

5. В приложении: **Компания → Топливные карты Opti** → источник **Opti API** → сохранить → **Проверить соединение**.

## Настройка для теста (имитация)

1. Привязать карты водителям (номер карты = как в Opti).
2. Источник: **Имитация**.
3. **Синхронизировать сейчас** — появятся тестовые заправки и расходы.

Автосинхронизация по умолчанию каждые 5 минут (`fuel_settings.sync_interval_minutes`).
