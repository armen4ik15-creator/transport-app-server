const db = require('../database');

function logActivity(userId, action, details) {
  try {
    db.prepare(
      `INSERT INTO activity_log (user_id, action, details)
       VALUES (?, ?, ?)`
    ).run(userId || null, action, details ? JSON.stringify(details) : null);
  } catch (_err) {
    // Логирование активности не должно ломать основной сценарий.
  }
}

module.exports = { logActivity };
