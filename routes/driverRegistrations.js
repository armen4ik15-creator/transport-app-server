const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');

const router = express.Router();
router.use(authMiddleware);
router.use(requireRole('admin'));

const REQUEST_SELECT = `
  SELECT
    r.id, r.email, r.full_name, r.phone,
    r.license_number, r.license_expiry, r.medical_check_expiry,
    r.status, r.reviewed_by, r.reviewed_at, r.rejection_reason, r.created_at,
    reviewer.email AS reviewed_by_email,
    reviewer.full_name AS reviewed_by_name
  FROM driver_registration_requests r
  LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by
`;

const DRIVER_WITH_USER = `
  SELECT
    d.id, d.user_id, d.license_number, d.license_expiry, d.medical_check_expiry,
    d.is_active, d.car_number, d.created_at,
    u.email, u.full_name, u.phone
  FROM drivers d
  JOIN users u ON u.id = d.user_id
`;

function getRequestById(id) {
  return db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(id);
}

function notifyAllAdmins(message, refId) {
  const targets = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all();
  const insert = db.prepare(
    `INSERT INTO notifications (user_id, message, read, kind, ref_id)
     VALUES (?, ?, 0, 'driver_registration', ?)`
  );
  targets.forEach((admin) => {
    insert.run(admin.id, message, refId);
  });
}

router.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `${REQUEST_SELECT}
       ORDER BY
         CASE r.status WHEN 'pending' THEN 0 ELSE 1 END,
         r.created_at DESC
       LIMIT 100`
    )
    .all();
  return res.json(rows);
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = getRequestById(id);
  if (!row) return res.status(404).json({ error: 'Заявка не найдена' });
  return res.json(row);
});

router.post('/:id/approve', (req, res) => {
  const id = Number(req.params.id);
  const request = db
    .prepare(`SELECT * FROM driver_registration_requests WHERE id = ?`)
    .get(id);
  if (!request) return res.status(404).json({ error: 'Заявка не найдена' });
  if (request.status !== 'pending') {
    return res.status(409).json({ error: 'Заявка уже обработана' });
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(request.email);
  if (existingUser) {
    return res.status(409).json({ error: 'Email уже зарегистрирован' });
  }

  const driverId = db.transaction(() => {
    const userInsert = db
      .prepare(
        `INSERT INTO users
         (email, password_hash, role, full_name, phone, password_reset_enabled, is_owner)
         VALUES (?, ?, 'driver', ?, ?, 1, 0)`
      )
      .run(
        request.email,
        request.password_hash,
        request.full_name,
        request.phone || null
      );

    const driverInsert = db
      .prepare(
        `INSERT INTO drivers
         (user_id, license_number, license_expiry, medical_check_expiry, is_active)
         VALUES (?, ?, ?, ?, 1)`
      )
      .run(
        userInsert.lastInsertRowid,
        request.license_number || null,
        request.license_expiry || null,
        request.medical_check_expiry || null
      );

    db.prepare(
      `UPDATE driver_registration_requests
       SET status = 'approved',
           reviewed_by = ?,
           reviewed_at = datetime('now'),
           rejection_reason = NULL
       WHERE id = ?`
    ).run(req.user.id, id);

    db.prepare(
      `UPDATE notifications SET read = 1
       WHERE kind = 'driver_registration' AND ref_id = ?`
    ).run(id);

    return driverInsert.lastInsertRowid;
  });

  logActivity(req.user.id, 'driver_registration.approve', {
    request_id: id,
    driver_id: driverId,
    email: request.email,
  });

  const driver = db.prepare(`${DRIVER_WITH_USER} WHERE d.id = ?`).get(driverId);

  return res.json({
    ok: true,
    message: `Водитель ${request.full_name} одобрен. Может войти в приложение.`,
    request: getRequestById(id),
    driver,
  });
});

router.post('/:id/reject', (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body || {};
  const request = db
    .prepare(`SELECT * FROM driver_registration_requests WHERE id = ?`)
    .get(id);
  if (!request) return res.status(404).json({ error: 'Заявка не найдена' });
  if (request.status !== 'pending') {
    return res.status(409).json({ error: 'Заявка уже обработана' });
  }

  db.prepare(
    `UPDATE driver_registration_requests
     SET status = 'rejected',
         reviewed_by = ?,
         reviewed_at = datetime('now'),
         rejection_reason = ?
     WHERE id = ?`
  ).run(req.user.id, reason ? String(reason).trim() : null, id);

  db.prepare(
    `UPDATE notifications SET read = 1
     WHERE kind = 'driver_registration' AND ref_id = ?`
  ).run(id);

  logActivity(req.user.id, 'driver_registration.reject', {
    request_id: id,
    email: request.email,
    reason: reason || null,
  });

  return res.json({
    ok: true,
    message: 'Заявка отклонена',
    request: getRequestById(id),
  });
});

module.exports = { router, notifyAllAdmins };
