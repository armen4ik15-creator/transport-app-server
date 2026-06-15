const express = require('express');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');

const router = express.Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300);

  if (req.user.role === 'admin') {
    const rows = db
      .prepare(
        `SELECT n.*, u.email AS user_email
         FROM notifications n
         LEFT JOIN users u ON u.id = n.user_id
         ORDER BY n.created_at DESC
         LIMIT ?`
      )
      .all(limit);
    return res.json(rows);
  }
  const rows = db
    .prepare(
      `SELECT n.*, u.email AS user_email
       FROM notifications n
       LEFT JOIN users u ON u.id = n.user_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC
       LIMIT ?`
    )
    .all(req.user.id, limit);
  return res.json(rows);
});

router.post('/', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  const { user_id, message } = req.body || {};
  if (!user_id || !message || !String(message).trim()) {
    return res.status(400).json({ error: 'user_id и message обязательны' });
  }
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(Number(user_id));
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const result = db
    .prepare(
      `INSERT INTO notifications (user_id, message, read)
       VALUES (?, ?, 0)`
    )
    .run(Number(user_id), String(message).trim());
  logActivity(req.user.id, 'notifications.create', { notification_id: result.lastInsertRowid });
  const created = db.prepare('SELECT * FROM notifications WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json(created);
});

router.put('/:id/read', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Уведомление не найдено' });
  if (req.user.role !== 'admin' && Number(row.user_id) !== req.user.id) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
  return res.json(db.prepare('SELECT * FROM notifications WHERE id = ?').get(id));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Уведомление не найдено' });
  if (req.user.role !== 'admin' && Number(row.user_id) !== req.user.id) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  db.prepare('DELETE FROM notifications WHERE id = ?').run(id);
  logActivity(req.user.id, 'notifications.delete', { notification_id: id });
  return res.json({ ok: true });
});

module.exports = router;
