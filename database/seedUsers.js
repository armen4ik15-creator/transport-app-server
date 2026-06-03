const { hashPasswordSync } = require('../utils/password');

const DEFAULT_ADMIN = {
  email: 'admin@test.com',
  password: 'admin123',
  fullName: 'Тестовый Администратор',
};

/** Основной админ production — создаётся при первом запуске, если записи ещё нет. */
const PRODUCTION_OWNER = {
  email: 'spartakus_dominionus@mail.ru',
  fullName: 'Администратор',
};

function ensureUser(db, { email, password, role, fullName }) {
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return false;
  const hash = hashPasswordSync(password);
  db.prepare(
    'INSERT INTO users (email, password_hash, role, full_name, phone) VALUES (?, ?, ?, ?, ?)'
  ).run(email, hash, role, fullName, null);
  return true;
}

function seedDefaultAdmin(db) {
  if (ensureUser(db, { ...DEFAULT_ADMIN, role: 'admin' })) {
    console.log(`[seed] ${DEFAULT_ADMIN.email} / ${DEFAULT_ADMIN.password} создан`);
  }
}

function seedProductionOwner(db) {
  if (process.env.NODE_ENV !== 'production') return;
  const tempPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || 'ReestrBootstrap2026';
  const created = ensureUser(db, {
    email: PRODUCTION_OWNER.email,
    password: tempPassword,
    role: 'admin',
    fullName: PRODUCTION_OWNER.fullName,
  });
  if (created) {
    console.log(`[seed] production admin ${PRODUCTION_OWNER.email} создан`);
  }
}

module.exports = { seedDefaultAdmin, seedProductionOwner };
