const { hashPasswordSync, hashPasswordAsync } = require('../utils/password');

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

  const hasExplicitPassword = Boolean(
    process.env.FOUNDER_ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD
  );
  const existing = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(founder.email);

  if (existing) {
    if (hasExplicitPassword) {
      const hash = hashPasswordSync(String(founder.password));
      db.prepare(
        `UPDATE users
         SET password_hash = ?, role = 'admin', full_name = ?, password_reset_enabled = 1, is_owner = 1
         WHERE id = ?`
      ).run(hash, founder.fullName, existing.id);
      console.log(`[seed] founder admin ${founder.email} updated (password + is_owner=1)`);
    } else {
      db.prepare(
        `UPDATE users
         SET role = 'admin', full_name = ?, password_reset_enabled = 1, is_owner = 1
         WHERE id = ?`
      ).run(founder.fullName, existing.id);
      console.log(`[seed] founder admin ${founder.email} updated (is_owner=1, password kept)`);
    }
  } else {
    const hash = hashPasswordSync(String(founder.password));
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

async function ensureUserAsync(client, { email, password, role, fullName, passwordResetEnabled = 0, isOwner = 0 }) {
  const passwordHash = await hashPasswordAsync(password);
  const exists = await client.query('SELECT id FROM users WHERE email = $1', [email]);
  if (exists.rows[0]) return false;
  await client.query(
    `INSERT INTO users
     (email, password_hash, role, full_name, phone, password_reset_enabled, is_owner)
     VALUES ($1, $2, $3, $4, NULL, $5, $6)`,
    [email, passwordHash, role, fullName, passwordResetEnabled, isOwner]
  );
  return true;
}

async function migrateLegacyFounderEmailAsync(client, targetEmail) {
  const legacy = LEGACY_FOUNDER_EMAIL.trim().toLowerCase();
  if (legacy === targetEmail) return;

  const legacyResult = await client.query('SELECT id FROM users WHERE email = $1', [legacy]);
  const legacyUser = legacyResult.rows[0];
  if (!legacyUser) return;

  const targetResult = await client.query('SELECT id FROM users WHERE email = $1', [targetEmail]);
  if (targetResult.rows[0]) {
    await client.query('UPDATE users SET is_owner = 0 WHERE id = $1', [legacyUser.id]);
    console.log(`[seed] legacy founder ${legacy} demoted (target ${targetEmail} already exists)`);
    return;
  }

  await client.query('UPDATE users SET email = $1 WHERE id = $2', [targetEmail, legacyUser.id]);
  console.log(`[seed] migrated founder email ${legacy} -> ${targetEmail}`);
}

async function seedDefaultAdminAsync(client) {
  if (await ensureUserAsync(client, { ...DEFAULT_ADMIN, role: 'admin' })) {
    console.log(`[seed] ${DEFAULT_ADMIN.email} / ${DEFAULT_ADMIN.password} создан`);
  }
}

async function seedFounderAdminAsync(client) {
  const founder = getFounderCredentials();
  const hasExplicitPassword = Boolean(
    process.env.FOUNDER_ADMIN_PASSWORD || process.env.BOOTSTRAP_ADMIN_PASSWORD
  );
  const founderPasswordHash = hasExplicitPassword
    ? await hashPasswordAsync(String(founder.password))
    : null;

  await migrateLegacyFounderEmailAsync(client, founder.email);

  const existingResult = await client.query(
    'SELECT id, password_hash FROM users WHERE email = $1',
    [founder.email]
  );
  const existing = existingResult.rows[0];

  if (existing) {
    if (hasExplicitPassword && founderPasswordHash) {
      await client.query(
        `UPDATE users
         SET password_hash = $1, role = 'admin', full_name = $2, password_reset_enabled = 1, is_owner = 1
         WHERE id = $3`,
        [founderPasswordHash, founder.fullName, existing.id]
      );
      console.log(`[seed] founder admin ${founder.email} updated (password + is_owner=1)`);
    } else {
      await client.query(
        `UPDATE users
         SET role = 'admin', full_name = $1, password_reset_enabled = 1, is_owner = 1
         WHERE id = $2`,
        [founder.fullName, existing.id]
      );
      console.log(`[seed] founder admin ${founder.email} updated (is_owner=1, password kept)`);
    }
  } else {
    const passwordHash = founderPasswordHash || (await hashPasswordAsync(String(founder.password)));
    await client.query(
      `INSERT INTO users
       (email, password_hash, role, full_name, phone, password_reset_enabled, is_owner)
       VALUES ($1, $2, 'admin', $3, NULL, 1, 1)`,
      [founder.email, passwordHash, founder.fullName]
    );
    console.log(`[seed] founder admin ${founder.email} created (is_owner=1)`);
  }

  await client.query('UPDATE users SET is_owner = 0 WHERE email != $1 AND is_owner = 1', [
    founder.email,
  ]);
}

async function seedAdminAsync(client) {
  await seedDefaultAdminAsync(client);
  await seedFounderAdminAsync(client);
}

module.exports = {
  seedDefaultAdmin,
  seedFounderAdmin,
  seedProductionOwner,
  seedAdminAsync,
};