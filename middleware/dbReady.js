const db = require('../database');

function isDatabaseReady() {
  const kind = db.kind;
  return kind === 'postgres' || kind === 'sqlite';
}

function requireDatabase(req, res, next) {
  if (req.method === 'GET' && (req.path === '/security-config' || req.path === '/health/live')) {
    return next();
  }
  if (isDatabaseReady()) {
    return next();
  }
  return res.status(503).json({
    error: 'Сервер подключается к базе данных. Подождите 30 секунд и попробуйте снова.',
  });
}

module.exports = { requireDatabase, isDatabaseReady };
