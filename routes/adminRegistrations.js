const express = require('express');
const db = require('../database');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');

const router = express.Router();
router.use(authMiddleware);
router.use(requireRole('admin'));

const REQUEST_SELECT = `
  SELECT
    r.id, r.email, r.full_name, r.phone, r.status,
    r.reviewed_by, r.reviewed_at, r.rejection_reason, r.created_at,
    reviewer.email AS reviewed_by_email,
    reviewer.full_name AS reviewed_by_name
  FROM admin_registration_requests r
  LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by
`;

function getRequestById(id) {
  return db.prepare(`${REQUEST_SELECT} WHERE r.id = ?`).get(id);
}

function isOwnerAdmin(userId) {
  const row = db.prepare('SELECT is_owner FROM users WHERE id = ?').get(userId);
  return Boolean(row && Number(row.is_owner) === 1);
}

function requireOwnerAdmin(req, res, next) {
  if (!isOwnerAdmin(req.user.id)) {
    return res.status(403).json({
      error: 'Только главный администратор может одобрять или отклонять заявки учредителей',
    });
  }
  return next();
}

function notifyOwnerAdmins(message, refId) {
  let targets = db
    .prepare(`SELECT id FROM users WHERE role = 'admin' AND is_owner = 1`)
    .all();
  if (targets.length === 0) {
    targets = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all();
  }
  const insert = db.prepare(
    `INSERT INTO notifications (user_id, message, read, kind, ref_id)
     VALUES (?, ?, 0, 'admin_registration', ?)`
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

router.post('/:id/approve', requireOwnerAdmin, (req, res) => {
  const id = Number(req.params.id);
  const request = db
    .prepare(`SELECT * FROM admin_registration_requests WHERE id = ?`)
    .get(id);
  if (!request) return res.status(404).json({ error: 'Заявка не найдена' });
  if (request.status !== 'pending') {
    return res.status(409).json({ error: 'Заявка уже обработана' });
  }

  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(request.email);
  if (existingUser) {
    return res.status(409).json({ error: 'Email уже зарегистрирован' });
  }

  const approveRequest = db.transaction(() => {
    const userInsert = db
      .prepare(
        `INSERT INTO users
         (email, password_hash, role, full_name, phone, password_reset_enabled, is_owner)
         VALUES (?, ?, 'admin', ?, ?, 1, 0)`
      )
      .run(
        request.email,
        request.password_hash,
        request.full_name,
        request.phone || null
      );

    db.prepare(
      `UPDATE admin_registration_requests
       SET status = 'approved',
           reviewed_by = ?,
           reviewed_at = datetime('now'),
           rejection_reason = NULL
       WHERE id = ?`
    ).run(req.user.id, id);

    db.prepare(
      `UPDATE notifications SET read = 1
       WHERE kind = 'admin_registration' AND ref_id = ?`
    ).run(id);

    return userInsert.lastInsertRowid;
  });

  const userId = approveRequest();
  logActivity(req.user.id, 'admin_registration.approve', {
    request_id: id,
    user_id: userId,
    email: request.email,
  });

  return res.json({
    ok: true,
    message: `Учредитель ${request.full_name} одобрен. Может войти как администратор.`,
    request: getRequestById(id),
    user_id: userId,
  });
});

router.post('/:id/reject', requireOwnerAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body || {};
  const request = db
    .prepare(`SELECT * FROM admin_registration_requests WHERE id = ?`)
    .get(id);
  if (!request) return res.status(404).json({ error: 'Заявка не найдена' });
  if (request.status !== 'pending') {
    return res.status(409).json({ error: 'Заявка уже обработана' });
  }

  db.prepare(
    `UPDATE admin_registration_requests
     SET status = 'rejected',
         reviewed_by = ?,
         reviewed_at = datetime('now'),
         rejection_reason = ?
     WHERE id = ?`
  ).run(req.user.id, reason ? String(reason).trim() : null, id);

  db.prepare(
    `UPDATE notifications SET read = 1
     WHERE kind = 'admin_registration' AND ref_id = ?`
  ).run(id);

  logActivity(req.user.id, 'admin_registration.reject', {
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

module.exports = { router, notifyOwnerAdmins };
