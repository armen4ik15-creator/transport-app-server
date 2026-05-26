# РеестрПро — сервер

Node.js + Express + SQLite + JWT. Все данные хранятся в `data.sqlite` рядом с `server.js`.

## Установка и запуск

```bash
cd server
npm install
node server.js
```

Сервер слушает `0.0.0.0:3000`. При первом запуске:
- создаёт `data.sqlite` со всеми таблицами;
- создаёт тестового админа `admin@test.com` / `admin123`.

## Окружение

Скопируйте `.env.example` в `.env` и при желании задайте `JWT_SECRET`.

## Где взять IP сервера (для мобильного приложения)

На Windows откройте PowerShell и выполните:

```powershell
ipconfig
```

Возьмите `IPv4-адрес` из вашего активного сетевого адаптера (Wi-Fi), например `192.168.1.42`.
В мобильном приложении (`mobile/config.js`) пропишите:

```js
export const API_URL = 'http://192.168.1.42:3000/api';
```

> Телефон и компьютер должны быть в одной Wi-Fi сети.
> На Windows может потребоваться разрешить входящие соединения на порт 3000 в брандмауэре.

## Эндпоинты

| Метод | Путь | Кто |
|------|------|-----|
| POST | /api/auth/register | все |
| POST | /api/auth/login | все |
| GET | /api/auth/me | авторизованный |
| GET | /api/drivers | admin: все; driver: себя |
| POST | /api/drivers | admin |
| PUT | /api/drivers/:id | admin |
| DELETE | /api/drivers/:id | admin |
| GET/POST/PUT/DELETE | /api/contractors[/:id] | admin |
| GET | /api/orders | admin: все; driver: свои |
| GET | /api/orders/:id | admin или владелец |
| POST | /api/orders | admin |
| PUT | /api/orders/:id/status | driver — только свой; admin — любой |
| POST | /api/orders/:id/photos | multipart (`photo`); driver — только свой |

## Хранение файлов

Загруженные фото лежат в `server/uploads/` и отдаются как `http://<ip>:3000/uploads/<file>`.
