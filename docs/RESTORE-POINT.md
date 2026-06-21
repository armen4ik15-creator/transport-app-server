# Restore point: 2026-06-22 (production baseline)

Use this snapshot to roll back if later changes break ReestrPro.

## Git tags

| Repo | Tag | Commit |
|------|-----|--------|
| transport-app-server | `restore-point/2026-06-22-production` | see `git show` |
| transport-app-mobile | `restore-point/2026-06-22-production` | `b503798` |

## Rollback commands

```bash
# Server
git fetch --tags
git checkout restore-point/2026-06-22-production
node scripts/timeweb-deploy.js   # TIMEWEB_APP_ID=211901 in timeweb.env

# Mobile
git fetch --tags
git checkout restore-point/2026-06-22-production
cd android && gradlew assembleRelease
```

## Timeweb (working production)

| Item | Value |
|------|--------|
| **App (use this)** | ID **211901** — ReestrPro Backend (Node/Express) |
| **API URL** | `https://armen4ik15-creator-transport-app-server-26b3.twc1.net/api` |
| **Host** | `armen4ik15-creator-transport-app-server-26b3.twc1.net` |
| **Port** | 443 |
| **PostgreSQL** | private `192.168.0.5`, `DATABASE_SSL=false` |

## Deprecated (do not use)

- App **211879** — Docker Compose, unstable DB from container network
- App **199564** — `43b9.twc1.net`, dead
- Hosts `43b9`, `1d1c` — mobile auto-migrates to `26b3` from v1.2.2

## Mobile APK baseline

- Version **1.2.2** (versionCode 22)
- Local copy: `C:\Users\Windows\Downloads\ReestrPro-v1.2.2.apk`
- Default server baked in: `26b3.twc1.net`

## Verified at restore point

- `GET /api/health` → `db_connected: true`
- `POST /api/auth/login` → HTTP 200
- Founder login: `aram_grigoryan96@bk.ru` (password in Timeweb env / panel only)

## Secrets

Never commit `timeweb.env`. Keep `DB_PASSWORD`, `JWT_SECRET`, founder password in Timeweb panel and local `timeweb.env` only.
