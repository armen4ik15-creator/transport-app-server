require('dotenv').config();
const path = require('path');
const os = require('os');
const express = require('express');
const cors = require('cors');
const { authMiddleware } = require('./middleware/auth');

require('./database');

const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const driversRoutes = require('./routes/drivers');
const contractorsRoutes = require('./routes/contractors');
const ordersRoutes = require('./routes/orders');
const financesRoutes = require('./routes/finances');
const documentsRoutes = require('./routes/documents');
const balancesRoutes = require('./routes/balances');
const reportsRoutes = require('./routes/reports');

const app = express();
const PORT = Number(process.env.PORT || 3000);

function getLocalIpv4Addresses() {
  const interfaces = os.networkInterfaces();
  const ips = new Set();
  Object.values(interfaces).forEach((entries) => {
    if (!entries) return;
    entries.forEach((entry) => {
      if (entry.family === 'IPv4' && !entry.internal) {
        ips.add(entry.address);
      }
    });
  });
  return Array.from(ips);
}

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', authMiddleware);
app.use('/api/drivers', driversRoutes);
app.use('/api/contractors', contractorsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/finances', financesRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api', balancesRoutes);
app.use('/api/reports', reportsRoutes);

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res
    .status(err.status || 500)
    .json({ error: err.message || 'Внутренняя ошибка сервера' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('────────────────────────────────────────');
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  const lanIps = getLocalIpv4Addresses();
  if (lanIps.length > 0) {
    lanIps.forEach((ip) => {
      console.log(`Сервер доступен по адресу: http://${ip}:${PORT}`);
    });
  } else {
    console.log(`Сервер доступен по адресу: http://127.0.0.1:${PORT}`);
  }
  console.log('Тестовый админ: admin@test.com / admin123');
  console.log('Эндпоинты:');
  console.log('  POST   /api/auth/register');
  console.log('  POST   /api/auth/login');
  console.log('  GET    /api/auth/me');
  console.log('  GET    /api/drivers           (admin: все, driver: себя)');
  console.log('  POST   /api/drivers           (admin)');
  console.log('  PUT    /api/drivers/:id       (admin)');
  console.log('  DELETE /api/drivers/:id       (admin)');
  console.log('  GET    /api/contractors       (admin)');
  console.log('  POST   /api/contractors       (admin)');
  console.log('  PUT    /api/contractors/:id   (admin)');
  console.log('  DELETE /api/contractors/:id   (admin)');
  console.log('  GET    /api/orders            (admin: все, driver: свои)');
  console.log('  GET    /api/orders/:id        (admin/owner)');
  console.log('  POST   /api/orders            (admin)');
  console.log('  PUT    /api/orders/:id/status (driver — для своих)');
  console.log('  POST   /api/orders/:id/photos (multipart, owner/admin)');
  console.log('  GET    /api/finances          (admin: все, driver: свои)');
  console.log('  POST   /api/finances          (admin)');
  console.log('  GET    /api/drivers/:id/balance (admin/owner)');
  console.log('  GET    /api/documents         (admin: все, driver: свои)');
  console.log('  POST   /api/documents         (multipart, admin/owner)');
  console.log('  DELETE /api/documents/:id     (admin/author)');
  console.log('  GET    /api/reports/summary   (admin: все/фильтр, driver: свои)');
  console.log('────────────────────────────────────────');
});
