const express = require('express');
const db = require('../database');
const { signToken } = require('../utils/jwt');
const { authMiddleware } = require('../middleware/auth');
const { hashPasswordSync, comparePasswordSync } = require('../utils/password');

const router = express.Router();

router.post('/register', (req, res) => {
  const {
    email,
    password,
    role = 'driver',
    full_name,
    phone,
    license_number,
    license_expiry,
    medical_check_expiry,
  } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email и password обязательны' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Пароль должен быть от 6 символов' });
  }
  if (!['admin', 'driver'].includes(role)) {
    return res.status(400).json({ error: 'role должен быть admin или driver' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'Email уже зарегистрирован' });

  const hash = hashPasswordSync(password);
  const registerUser = db.transaction(() => {
    const u = db
      .prepare('INSERT INTO users (email, password_hash, role, full_name, phone) VALUES (?, ?, ?, ?, ?)')
      .run(email, hash, role, full_name || email, phone || null);

    if (role === 'driver') {
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
    }
    return u.lastInsertRowid;
  });
  const userId = registerUser();

  const token = signToken({ id: userId, role, email });
  return res
    .status(201)
    .json({ token, user: { id: userId, email, role, full_name: full_name || email, phone: phone || null } });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email и password обязательны' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
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
