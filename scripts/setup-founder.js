/**
 * Создаёт или обновляет главного администратора-учредителя (is_owner=1).
 *
 * Usage:
 *   FOUNDER_ADMIN_EMAIL=you@mail.ru FOUNDER_ADMIN_PASSWORD=secret node scripts/setup-founder.js
 */
require('dotenv').config();
const db = require('../database');
const { hashPasswordSync } = require('../utils/password');

const email = (process.env.FOUNDER_ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.FOUNDER_ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD;
const fullName = (process.env.FOUNDER_ADMIN_FULL_NAME || 'Главный администратор').trim();

if (!email) {
  console.error('[setup-founder] Укажите FOUNDER_ADMIN_EMAIL');
  process.exit(1);
}
if (!password || String(password).length < 6) {
  console.error('[setup-founder] Укажите FOUNDER_ADMIN_PASSWORD (от 6 символов)');
  process.exit(1);
}

const existing = db.prepare('SELECT id, role, is_owner FROM users WHERE email = ?').get(email);
const hash = hashPasswordSync(String(password));

if (existing) {
  db.prepare(
    `UPDATE users
     SET password_hash = ?, role = 'admin', full_name = ?, password_reset_enabled = 1, is_owner = 1
     WHERE id = ?`
  ).run(hash, fullName, existing.id);
  console.log(`[setup-founder] Обновлён учредитель: ${email} (id=${existing.id})`);
} else {
  const result = db
    .prepare(
      `INSERT INTO users
       (email, password_hash, role, full_name, phone, password_reset_enabled, is_owner)
       VALUES (?, ?, 'admin', ?, NULL, 1, 1)`
    )
    .run(email, hash, fullName);
  console.log(`[setup-founder] Создан учредитель: ${email} (id=${result.lastInsertRowid})`);
}

process.exit(0);
