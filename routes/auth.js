const express = require('express');
const db = require('../database');
const { signToken } = require('../utils/jwt');
const { authMiddleware } = require('../middleware/auth');
const { hashPasswordSync, comparePasswordSync } = require('../utils/password');
const {
  canSelfRegister,
  getPublicSecurityConfig,
  validatePasswordStrength,
  validatePasswordResetCode,
  validateRegistrationInvite,
} = require('../utils/authPolicy');

const router = express.Router();

router.get('/security-config', (_req, res) => {
  return res.json(getPublicSecurityConfig());
});

router.post('/register', (req, res) => {
  const {
    email,
    password,
    role: _ignoredRole,
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

  if (!canSelfRegister()) {
    return res.status(403).json({
      error: 'Регистрация закрыта. Попросите администратора создать аккаунт.',
    });
  }

  if (!validateRegistrationInvite(invite_code)) {
    return res.status(403).json({
      error: 'Неверный код приглашения или регистрация отключена.',
    });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (exists) return res.status(409).json({ error: 'Email уже зарегистрирован' });

  const hash = hashPasswordSync(password);
  const registerUser = db.transaction(() => {
    const u = db
      .prepare('INSERT INTO users (email, password_hash, role, full_name, phone) VALUES (?, ?, ?, ?, ?)')
      .run(normalizedEmail, hash, 'driver', full_name || normalizedEmail, phone || null);

    db.prepare(
      `INSERT INTO drivers
       (user_id, license_number, license_expiry, medical_check_expiry, is_active)
       VALUES (?, ?, ?, ?, 1)`
    ).run(
      u.lastInsertRowid,
      license_number || null,
      license_expiry || null,
      medical_check_expiry || null
    );
    return u.lastInsertRowid;
  });
  const userId = registerUser();

  const token = signToken({ id: userId, role: 'driver', email: normalizedEmail });
  return res.status(201).json({
    token,
    user: {
      id: userId,
      email: normalizedEmail,
      role: 'driver',
      full_name: full_name || normalizedEmail,
      phone: phone || null,
    },
  });
});

router.post('/forgot-password', (req, res) => {
  const { email, reset_code, new_password } = req.body || {};
  if (!email || !reset_code || !new_password) {
    return res.status(400).json({ error: 'email, reset_code и new_password обязательны' });
  }

  const passwordError = validatePasswordStrength(new_password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  if (!validatePasswordResetCode(reset_code)) {
    return res.status(403).json({ error: 'Неверный код восстановления' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (!user) {
    return res.status(404).json({ error: 'Пользователь с таким email не найден' });
  }

  const hash = hashPasswordSync(new_password);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);

  return res.json({ ok: true, message: 'Пароль обновлён. Войдите с новым паролем.' });
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
