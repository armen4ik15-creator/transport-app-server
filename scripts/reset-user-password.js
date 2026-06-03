/**
 * Сброс пароля пользователя по email.
 * Локально: node scripts/reset-user-password.js email@example.com НовыйПароль123
 * На сервере: задайте DATABASE_URL или DB_* в .env, затем та же команда.
 */
require('dotenv').config();

const { hashPasswordSync } = require('../utils/password');

const email = process.argv[2]?.trim().toLowerCase();
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error('Использование: node scripts/reset-user-password.js <email> <новый_пароль>');
  process.exit(1);
}

if (String(newPassword).length < 6) {
  console.error('Пароль должен быть не короче 6 символов');
  process.exit(1);
}

const db = require('../database');

const user = db.prepare('SELECT id, email, role, full_name FROM users WHERE email = ?').get(email);

if (!user) {
  console.error(`Пользователь не найден: ${email}`);
  process.exit(1);
}

const hash = hashPasswordSync(newPassword);
db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);

console.log('Пароль обновлён.');
console.log(`  ID: ${user.id}`);
console.log(`  Email: ${user.email}`);
console.log(`  Роль: ${user.role}`);
console.log(`  ФИО: ${user.full_name ?? '—'}`);
console.log(`  Новый пароль: ${newPassword}`);
