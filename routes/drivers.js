const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { hashPasswordSync } = require('../utils/password');
const { normalizeEmail, isValidEmail } = require('../utils/email');

const router = express.Router();
router.use(authMiddleware);

const DRIVER_WITH_USER = `
  SELECT
    d.id, d.user_id, d.license_number, d.license_expiry, d.medical_check_expiry,
    d.is_active, d.car_number, COALESCE(d.senior_shift_bonus, 0) AS senior_shift_bonus,
    COALESCE(d.is_archived, 0) AS is_archived,
    COALESCE(d.salary_opening_accrued, 0) AS salary_opening_accrued,
    d.archived_at,
    d.created_at,
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
    senior_shift_bonus,
    is_archived,
    salary_opening_accrued,
  } = req.body || {};
  if (!email || !password || !full_name) {
    return res
      .status(400)
      .json({ error: 'email, password и full_name обязательны' });
  }
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Укажите корректный email (например driver@mail.ru)' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (exists) return res.status(409).json({ error: 'Email уже зарегистрирован' });

  let seniorBonus = 0;
  if (senior_shift_bonus != null && senior_shift_bonus !== '') {
    seniorBonus = Number(senior_shift_bonus);
    if (!Number.isFinite(seniorBonus) || seniorBonus < 0) {
      return res.status(400).json({ error: 'senior_shift_bonus должен быть числом ≥ 0' });
    }
  }

  const hash = hashPasswordSync(password);
  const driverId = db.transaction(() => {
    const u = db
      .prepare(
        `INSERT INTO users
         (email, password_hash, role, full_name, phone, password_reset_enabled, is_owner)
         VALUES (?, ?, 'driver', ?, ?, 1, 0)`
      )
      .run(normalizedEmail, hash, full_name, phone || null);
    const d = db
      .prepare(
        `INSERT INTO drivers
         (user_id, license_number, license_expiry, medical_check_expiry, is_active, car_number, senior_shift_bonus)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        u.lastInsertRowid,
        license_number || null,
        license_expiry || null,
        medical_check_expiry || null,
        is_active == null ? 1 : Number(Boolean(is_active)),
        car_number || null,
        seniorBonus
      );
    return d.lastInsertRowid;
  });
  const created = db
    .prepare(`${DRIVER_WITH_USER} WHERE d.id = ?`)
    .get(driverId);
  return res.status(201).json(created);
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const {
    email,
    full_name,
    phone,
    car_number,
    license_number,
    license_expiry,
    medical_check_expiry,
    is_active,
    senior_shift_bonus,
    is_archived,
    salary_opening_accrued,
    password,
  } = req.body || {};
  const driver = db.prepare('SELECT id, user_id FROM drivers WHERE id = ?').get(id);
  if (!driver) return res.status(404).json({ error: 'Водитель не найден' });

  if (password != null && String(password).length > 0) {
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Пароль должен быть от 6 символов' });
    }
    const hash = hashPasswordSync(String(password));
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, driver.user_id);
  }

  if (email != null && String(email).trim()) {
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Укажите корректный email (например driver@mail.ru)' });
    }
    const taken = db
      .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
      .get(normalizedEmail, driver.user_id);
    if (taken) return res.status(409).json({ error: 'Email уже зарегистрирован' });
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(normalizedEmail, driver.user_id);
  }

  let nextSenior = null;
  if (senior_shift_bonus !== undefined) {
    if (senior_shift_bonus === null || senior_shift_bonus === '') {
      nextSenior = 0;
    } else {
      nextSenior = Number(senior_shift_bonus);
      if (!Number.isFinite(nextSenior) || nextSenior < 0) {
        return res.status(400).json({ error: 'senior_shift_bonus должен быть числом ≥ 0' });
      }
    }
  }

  let nextArchived = null;
  let nextArchivedAt = null;
  if (is_archived !== undefined) {
    nextArchived = Number(Boolean(is_archived));
    if (nextArchived) {
      nextArchivedAt = new Date().toISOString();
    }
  }

  let nextOpeningAccrued = null;
  if (salary_opening_accrued !== undefined) {
    if (salary_opening_accrued === null || salary_opening_accrued === '') {
      nextOpeningAccrued = 0;
    } else {
      nextOpeningAccrued = Number(salary_opening_accrued);
      if (!Number.isFinite(nextOpeningAccrued) || nextOpeningAccrued < 0) {
        return res.status(400).json({ error: 'salary_opening_accrued должен быть числом ≥ 0' });
      }
    }
  }

  let nextArchivedAt = null;
  if (is_archived !== undefined) {
    nextArchived = Number(Boolean(is_archived));
    if (nextArchived) {
      const current = db.prepare('SELECT archived_at FROM drivers WHERE id = ?').get(id);
      nextArchivedAt = current?.archived_at || new Date().toISOString();
    } else {
      nextArchivedAt = null;
    }
  }

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
         is_active = COALESCE(?, is_active),
         senior_shift_bonus = COALESCE(?, senior_shift_bonus),
         is_archived = COALESCE(?, is_archived),
         salary_opening_accrued = COALESCE(?, salary_opening_accrued),
         archived_at = CASE WHEN ? IS NOT NULL THEN ? ELSE archived_at END
     WHERE id = ?`
  ).run(
    car_number ?? null,
    license_number ?? null,
    license_expiry ?? null,
    medical_check_expiry ?? null,
    is_active == null ? null : Number(Boolean(is_active)),
    nextSenior,
    nextArchived,
    nextOpeningAccrued,
    is_archived !== undefined ? 1 : null,
    nextArchivedAt,
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
