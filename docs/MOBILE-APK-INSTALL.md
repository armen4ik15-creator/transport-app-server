# Установка APK без Expo/Google

OTA и скачивание с `expo.dev` используют **Google Cloud**. Из многих сетей в РФ они **не открываются** — отсюда ошибки:
- `Failed to download new update`
- APK с Expo зависает на ~11 МБ

## Решение: APK с вашего сервера Timeweb

### 1. Соберите или скачайте APK на ПК

**Вариант A — локальная сборка** (без Expo CDN):
```powershell
cd C:\work\mobile\android
.\gradlew.bat assembleRelease
```
Файл: `android\app\build\outputs\apk\release\app-release.apk`

**Вариант B — VPN** → скачать с https://expo.dev/artifacts/eas/... → переименовать в `reestrpro.apk`

### 2. Загрузите APK на сервер

Положите файл в **`DATA_DIR/downloads/reestrpro.apk`** на контейнере Timeweb.

Или через панель Timeweb → Volume `/data` → папка `downloads` → `reestrpro.apk`

### 3. Пересоберите бэкенд (если ещё не деплоили маршрут `/downloads`)

Timeweb → ReestrPro Backend → **Пересобрать**

### 4. Установите на телефон

Откройте в **Chrome на телефоне**:
```
https://armen4ik15-creator-transport-app-server-26b3.twc1.net/downloads/reestrpro.apk
```

Разрешите установку из неизвестных источников → установить.

### 5. Проверка

`GET https://.../api/public/app-release` → `"apk_available": true`

---

## USB (если браузер на телефоне тоже не качает)

1. Скопируйте `reestrpro.apk` на телефон через USB / Telegram «Избранное»
2. Откройте файл на телефоне → Установить

---

## OTA после установки нового APK

Новый APK уже содержит кнопку фото. OTA можно не использовать, пока Google недоступен.
