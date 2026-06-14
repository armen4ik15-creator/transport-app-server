const { hashPasswordSync } = require('../utils/password');

const DEFAULT_ADMIN = {
  email: 'admin@test.com',
  password: 'admin123',
  fullName: 'Тестовый администратор',
};

const FOUNDER_FALLBACK_EMAIL = 'aram_grigoryan96@bk.ru';
const LEGACY_FOUNDER_EMAIL = 'spartakus_dominionus@mail.ru';

function getFounderCredentials() {
  const email = (process.env.FOUNDER_ADMIN_EMAIL || FOUNDER_FALLBACK_EMAIL).trim().toLowerCase();
  const password =
    process.env.FOUNDER_ADMIN_PASSWORD ||
    process.env.BOOTSTRAP_ADMIN_PASSWORD ||
    'ReestrBootstrap2026';
  const fullName = process.env.FOUNDER_ADMIN_FULL_NAME || 'Администратор';
  return { email, password, fullName };
}

function ensureUser(db, { email, password, role, fullName, passwordResetEnabled = 0, isOwner = 0 }) {
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return false;
  const hash = hashPasswordSync(password);
  db.prepare(
    `INSERT INTO users
     (email, password_hash, role, full_name, phone, password_reset_enabled, is_owner)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(email, hash, role, fullName, null, passwordResetEnabled, isOwner);
  return true;
}

function seedDefaultAdmin(db) {
  if (ensureUser(db, { ...DEFAULT_ADMIN, role: 'admin' })) {
    console.log(`[seed] ${DEFAULT_ADMIN.email} / ${DEFAULT_ADMIN.password} создан`);
  }
}

function migrateLegacyFounderEmail(db, targetEmail) {
  const legacy = LEGACY_FOUNDER_EMAIL.trim().toLowerCase();
  if (legacy === targetEmail) return;

  const legacyUser = db.prepare('SELECT id FROM users WHERE email = ?').get(legacy);
  if (!legacyUser) return;

  const targetExists = db.prepare('SELECT id FROM users WHERE email = ?').get(targetEmail);
  if (targetExists) {
    db.prepare('UPDATE users SET is_owner = 0 WHERE id = ?').run(legacyUser.id);
    console.log(`[seed] legacy founder ${legacy} demoted (target ${targetEmail} already exists)`);
    return;
  }

  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(targetEmail, legacyUser.id);
  console.log(`[seed] migrated founder email ${legacy} -> ${targetEmail}`);
}

function seedFounderAdmin(db) {
  const founder = getFounderCredentials();
  migrateLegacyFounderEmail(db, founder.email);

  const hash = hashPasswordSync(String(founder.password));
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(founder.email);

  if (existing) {
    db.prepare(
      `UPDATE users
       SET password_hash = ?, role = 'admin', full_name = ?, password_reset_enabled = 1, is_owner = 1
       WHERE id = ?`
    ).run(hash, founder.fullName, existing.id);
    console.log(`[seed] founder admin ${founder.email} updated (is_owner=1)`);
  } else {
    db.prepare(
      `INSERT INTO users
       (email, password_hash, role, full_name, phone, password_reset_enabled, is_owner)
       VALUES (?, ?, 'admin', ?, NULL, 1, 1)`
    ).run(founder.email, hash, founder.fullName);
    console.log(`[seed] founder admin ${founder.email} created (is_owner=1)`);
  }

  db.prepare('UPDATE users SET is_owner = 0 WHERE email != ? AND is_owner = 1').run(founder.email);
}

/** @deprecated use seedFounderAdmin */
function seedProductionOwner(db) {
  seedFounderAdmin(db);
}

module.exports = { seedDefaultAdmin, seedFounderAdmin, seedProductionOwner };