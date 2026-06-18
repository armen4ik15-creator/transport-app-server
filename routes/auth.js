const express = require('express');
const db = require('../database');
const { signToken } = require('../utils/jwt');
const { authMiddleware } = require('../middleware/auth');
const { hashPasswordSync, comparePasswordSync } = require('../utils/password');
const {
  getPublicSecurityConfig,
  validatePasswordStrength,
  validatePasswordResetForUser,
  validatePasswordResetCode,
} = require('../utils/authPolicy');
const { notifyOwnerAdmins } = require('./adminRegistrations');
const { notifyAllAdmins: notifyDriverRegistrationAdmins } = require('./driverRegistrations');
const { normalizeEmail, isValidEmail } = require('../utils/email');

const router = express.Router();

function normalizeRole(role) {
  const raw = String(role || 'driver').trim().toLowerCase();
  if (raw === 'founder' || raw === 'admin') return 'admin';
  return 'driver';
}

function isAdminRegistrationRole(role) {
  return role === 'admin';
}

router.get('/security-config', (_req, res) => {
  return res.json(getPublicSecurityConfig());
});

router.post('/register', (req, res) => {
  const {
    email,
    password,
    confirm_password,
    role: roleInput,
    invite_code,
    full_name,
    phone,
    license_number,
    license_expiry,
    medical_check_expiry,
  } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'email и password обязательны' });
  }

  const passwordError = validatePasswordStrength(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  const role = normalizeRole(roleInput);
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Укажите корректный email (например driver@mail.ru)' });
  }

  if (isAdminRegistrationRole(role)) {
    if (!full_name || !String(full_name).trim()) {
      return res.status(400).json({ error: 'full_name обязателен для учредителя' });
    }
    if (!confirm_password) {
      return res.status(400).json({ error: 'confirm_password обязателен' });
    }
    if (String(password) !== String(confirm_password)) {
      return res.status(400).json({ error: 'Пароли не совпадают' });
    }

    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (exists) return res.status(409).json({ error: 'Email уже зарегистрирован' });

    const pending = db
      .prepare(
        `SELECT id FROM admin_registration_requests
         WHERE email = ? AND status = 'pending'`
      )
      .get(normalizedEmail);
    if (pending) {
      return res.status(409).json({ error: 'Заявка на этот email уже ожидает одобрения' });
    }

    const hash = hashPasswordSync(password);
    const result = db
      .prepare(
        `INSERT INTO admin_registration_requests
         (email, password_hash, full_name, phone, status)
         VALUES (?, ?, ?, ?, 'pending')`
      )
      .run(normalizedEmail, hash, String(full_name).trim(), phone || null);

    const requestId = result.lastInsertRowid;
    const message = `Новая заявка учредителя: ${String(full_name).trim()} (${normalizedEmail})`;
    notifyOwnerAdmins(message, requestId);

    return res.status(201).json({
      pending: true,
      message: 'Ожидайте одобрения главного администратора',
    });
  }

  if (!full_name || !String(full_name).trim()) {
    return res.status(400).json({ error: 'full_name обязателен для водителя' });
  }
  if (!confirm_password) {
    return res.status(400).json({ error: 'confirm_password обязателен' });
  }
  if (String(password) !== String(confirm_password)) {
    return res.status(400).json({ error: 'Пароли не совпадают' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (exists) return res.status(409).json({ error: 'Email уже зарегистрирован' });

  const pendingDriver = db
    .prepare(
      `SELECT id FROM driver_registration_requests
       WHERE email = ? AND status = 'pending'`
    )
    .get(normalizedEmail);
  if (pendingDriver) {
    return res.status(409).json({ error: 'Заявка на этот email уже ожидает одобрения' });
  }

  const hash = hashPasswordSync(password);
  const result = db
    .prepare(
      `INSERT INTO driver_registration_requests
       (email, password_hash, full_name, phone, license_number, license_expiry, medical_check_expiry, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(
      normalizedEmail,
      hash,
      String(full_name).trim(),
      phone || null,
      license_number || null,
      license_expiry || null,
      medical_check_expiry || null
    );

  const requestId = result.lastInsertRowid;
  const message = `Новая заявка водителя: ${String(full_name).trim()} (${normalizedEmail})`;
  notifyDriverRegistrationAdmins(message, requestId);

  return res.status(201).json({
    pending: true,
    message: 'Ожидайте одобрения администратора',
  });
});

router.post('/forgot-password', (req, res) => {
  const { email, reset_code, new_password } = req.body || {};
  if (!email || !new_password) {
    return res.status(400).json({ error: 'email и new_password обязательны' });
  }

  const passwordError = validatePasswordStrength(new_password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Укажите корректный email' });
  }

  const user = db
    .prepare('SELECT id, password_reset_enabled FROM users WHERE email = ?')
    .get(normalizedEmail);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь с таким email не найден' });
  }

  const resetCodeError = validatePasswordResetForUser(user, reset_code);
  if (resetCodeError) {
    return res.status(403).json({ error: resetCodeError });
  }

  const hash = hashPasswordSync(new_password);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);

  return res.json({ ok: true, message: 'Пароль обновлён. Войдите с новым паролем.' });
});

/** Одноразовая миграция email учредителя (код восстановления = секрет). */
router.post('/migrate-founder', (req, res) => {
  const { reset_code, target_email, password, full_name } = req.body || {};
  if (!reset_code || !target_email || !password) {
    return res.status(400).json({ error: 'reset_code, target_email и password обязательны' });
  }

  const passwordError = validatePasswordStrength(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  if (!validatePasswordResetCode(reset_code)) {
    return res.status(403).json({ error: 'Неверный код восстановления' });
  }

  const normalizedEmail = String(target_email).trim().toLowerCase();
  const taken = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (taken) {
    return res.status(409).json({ error: 'Email уже занят' });
  }

  const owner = db
    .prepare(
      `SELECT id, email FROM users
       WHERE is_owner = 1 OR email IN ('spartakus_dominionus@mail.ru', 'aram_grigoryan96@bk.ru')
       ORDER BY is_owner DESC, id ASC
       LIMIT 1`
    )
    .get();
  if (!owner) {
    return res.status(404).json({ error: 'Учредитель не найден' });
  }

  const hash = hashPasswordSync(String(password));
  const displayName = full_name ? String(full_name).trim() : 'Арам Григорян';

  db.prepare(
    `UPDATE users
     SET email = ?, password_hash = ?, full_name = ?, role = 'admin',
         password_reset_enabled = 1, is_owner = 1
     WHERE id = ?`
  ).run(normalizedEmail, hash, displayName, owner.id);

  db.prepare('UPDATE users SET is_owner = 0 WHERE id != ? AND is_owner = 1').run(owner.id);

  return res.json({
    ok: true,
    message: `Учредитель перенесён на ${normalizedEmail}. Можно входить.`,
    previous_email: owner.email,
    user_id: owner.id,
  });
});

router.post('/change-password', authMiddleware, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'current_password и new_password обязательны' });
  }

  const passwordError = validatePasswordStrength(new_password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  if (!comparePasswordSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Текущий пароль неверный' });
  }

  const hash = hashPasswordSync(new_password);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);

  return res.json({ ok: true, message: 'Пароль изменён' });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email и password обязательны' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();

  const pendingAdmin = db
    .prepare(
      `SELECT id FROM admin_registration_requests
       WHERE email = ? AND status = 'pending'`
    )
    .get(normalizedEmail);
  if (pendingAdmin) {
    return res.status(403).json({
      error: 'Заявка на регистрацию ожидает одобрения администратора',
    });
  }

  const pendingDriver = db
    .prepare(
      `SELECT id FROM driver_registration_requests
       WHERE email = ? AND status = 'pending'`
    )
    .get(normalizedEmail);
  if (pendingDriver) {
    return res.status(403).json({
      error: 'Заявка на регистрацию ожидает одобрения администратора',
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!user) return res.status(401).json({ error: 'Неверный email или пароль' });
  if (!comparePasswordSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Неверный email или пароль' });
  }
  const token = signToken({ id: user.id, role: user.role, email: user.email });
  return res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      full_name: user.full_name || null,
      phone: user.phone || null,
    },
  });
});

router.get('/me', authMiddleware, (req, res) => {
  const user = db
    .prepare('SELECT id, email, role, full_name, phone, created_at FROM users WHERE id = ?')
    .get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const driver = db
    .prepare(
      `SELECT
         d.id, d.user_id, d.license_number, d.license_expiry, d.medical_check_expiry,
         d.is_active, d.car_number, d.created_at,
         u.email, u.full_name, u.phone
       FROM drivers d
       JOIN users u ON u.id = d.user_id
       WHERE d.user_id = ?`
    )
    .get(user.id);
  return res.json({ user, driver: driver || null });
});

module.exports = router;
