const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { hashPasswordSync } = require('../utils/password');

const router = express.Router();
router.use(authMiddleware);

const DRIVER_WITH_USER = `
  SELECT
    d.id, d.user_id, d.license_number, d.license_expiry, d.medical_check_expiry,
    d.is_active, d.car_number, d.created_at,
    u.email, u.full_name, u.phone
  FROM drivers d
  JOIN users u ON u.id = d.user_id
`;

router.get('/', (req, res) => {
  if (req.user.role === 'admin') {
    const rows = db.prepare(`${DRIVER_WITH_USER} ORDER BY u.full_name`).all();
    return res.json(rows);
  }
  const own = db
    .prepare(`${DRIVER_WITH_USER} WHERE d.user_id = ?`)
    .get(req.user.id);
  return res.json(own ? [own] : []);
});

router.post('/', requireRole('admin'), (req, res) => {
  const {
    email,
    password,
    full_name,
    phone,
    car_number,
    license_number,
    license_expiry,
    medical_check_expiry,
    is_active,
  } = req.body || {};
  if (!email || !password || !full_name) {
    return res
      .status(400)
      .json({ error: 'email, password и full_name обязательны' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'Email уже зарегистрирован' });

  const hash = hashPasswordSync(password);
  const createDriver = db.transaction(() => {
    const u = db
      .prepare('INSERT INTO users (email, password_hash, role, full_name, phone) VALUES (?, ?, ?, ?, ?)')
      .run(email, hash, 'driver', full_name, phone || null);
    const d = db
      .prepare(
        `INSERT INTO drivers
         (user_id, license_number, license_expiry, medical_check_expiry, is_active, car_number)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        u.lastInsertRowid,
        license_number || null,
        license_expiry || null,
        medical_check_expiry || null,
        is_active == null ? 1 : Number(Boolean(is_active)),
        car_number || null
      );
    return d.lastInsertRowid;
  });
  const driverId = createDriver();
  const created = db
    .prepare(`${DRIVER_WITH_USER} WHERE d.id = ?`)
    .get(driverId);
  return res.status(201).json(created);
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const {
    full_name,
    phone,
    car_number,
    license_number,
    license_expiry,
    medical_check_expiry,
    is_active,
  } = req.body || {};
  const driver = db.prepare('SELECT id, user_id FROM drivers WHERE id = ?').get(id);
  if (!driver) return res.status(404).json({ error: 'Водитель не найден' });
  db.prepare('UPDATE users SET full_name = COALESCE(?, full_name), phone = ? WHERE id = ?').run(
    full_name ?? null,
    phone ?? null,
    driver.user_id
  );
  db.prepare(
    `UPDATE drivers
     SET car_number = ?,
         license_number = ?,
         license_expiry = ?,
         medical_check_expiry = ?,
         is_active = COALESCE(?, is_active)
     WHERE id = ?`
  ).run(
    car_number ?? null,
    license_number ?? null,
    license_expiry ?? null,
    medical_check_expiry ?? null,
    is_active == null ? null : Number(Boolean(is_active)),
    id
  );
  const updated = db.prepare(`${DRIVER_WITH_USER} WHERE d.id = ?`).get(id);
  return res.json(updated);
});

router.put('/profile/me', (req, res) => {
  if (req.user.role !== 'driver') {
    return res.status(403).json({ error: 'Только для водителей' });
  }
  const own = db.prepare('SELECT id, user_id FROM drivers WHERE user_id = ?').get(req.user.id);
  if (!own) return res.status(404).json({ error: 'Профиль водителя не найден' });
  const { full_name, phone, car_number, license_number, license_expiry, medical_check_expiry } = req.body || {};
  db.prepare('UPDATE users SET full_name = COALESCE(?, full_name), phone = COALESCE(?, phone) WHERE id = ?').run(
    full_name ? String(full_name).trim() : null,
    phone ? String(phone).trim() : null,
    own.user_id
  );
  db.prepare(
    `UPDATE drivers
     SET car_number = COALESCE(?, car_number),
         license_number = COALESCE(?, license_number),
         license_expiry = COALESCE(?, license_expiry),
         medical_check_expiry = COALESCE(?, medical_check_expiry)
     WHERE id = ?`
  ).run(
    car_number ? String(car_number).trim() : null,
    license_number ? String(license_number).trim() : null,
    license_expiry ? String(license_expiry).trim() : null,
    medical_check_expiry ? String(medical_check_expiry).trim() : null,
    own.id
  );
  return res.json(db.prepare(`${DRIVER_WITH_USER} WHERE d.id = ?`).get(own.id));
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const driver = db
    .prepare('SELECT user_id FROM drivers WHERE id = ?')
    .get(id);
  if (!driver) return res.status(404).json({ error: 'Водитель не найден' });
  db.prepare('DELETE FROM users WHERE id = ?').run(driver.user_id);
  return res.json({ ok: true });
});

module.exports = router;
