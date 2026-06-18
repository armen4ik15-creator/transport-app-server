require('dotenv').config();
const os = require('os');
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const { UPLOADS_DIR, ensureDataStorage } = require('./config/paths');

ensureDataStorage();

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

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

app.get('/api/health/live', (_req, res) => {
  res.json({
    status: 'ok',
    app_version: process.env.APP_VERSION || '1.3.0',
    git_commit: process.env.GIT_COMMIT_SHA || null,
    driver_registration_available: true,
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    app_version: process.env.APP_VERSION || '1.3.0',
    git_commit: process.env.GIT_COMMIT_SHA || null,
    booting: true,
  });
});

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'reestrpro-api' });
});

function mountRoutes() {
  require('./database');

  const { authMiddleware } = require('./middleware/auth');
  const healthRoutes = require('./routes/health');
  const authRoutes = require('./routes/auth');
  const driversRoutes = require('./routes/drivers');
  const contractorsRoutes = require('./routes/contractors');
  const ordersRoutes = require('./routes/orders');
  const financesRoutes = require('./routes/finances');
  const documentsRoutes = require('./routes/documents');
  const templatesRoutes = require('./routes/templates');
  const orderTemplatesRoutes = require('./routes/orderTemplates');
  const materialsRoutes = require('./routes/materials');
  const vehiclesRoutes = require('./routes/vehicles');
  const waybillsRoutes = require('./routes/waybills');
  const invoicesRoutes = require('./routes/invoices');
  const notificationsRoutes = require('./routes/notifications');
  const activityRoutes = require('./routes/activity');
  const balancesRoutes = require('./routes/balances');
  const reportsRoutes = require('./routes/reports');
  const expensesRoutes = require('./routes/expenses');
  const tripsRoutes = require('./routes/trips');
  const photosRoutes = require('./routes/photos');
  const exportExcelRoutes = require('./routes/exportExcel');
  const earningsRoutes = require('./routes/earnings');
  const salaryRoutes = require('./routes/salary');
  const contractorPaymentsRoutes = require('./routes/contractorPayments');
  const backupsRoutes = require('./routes/backups');
  const dashboardRoutes = require('./routes/dashboard');
  const { router: adminRegistrationsRoutes } = require('./routes/adminRegistrations');
  const { router: driverRegistrationsRoutes } = require('./routes/driverRegistrations');

  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api', authMiddleware);
  app.use('/api/drivers', driversRoutes);
  app.use('/api/contractors', contractorPaymentsRoutes);
  app.use('/api/contractors', contractorsRoutes);
  app.use('/api/orders', ordersRoutes);
  app.use('/api/finances', financesRoutes);
  app.use('/api/documents', documentsRoutes);
  app.use('/api/templates', templatesRoutes);
  app.use('/api/order-templates', orderTemplatesRoutes);
  app.use('/api/materials', materialsRoutes);
  app.use('/api/vehicles', vehiclesRoutes);
  app.use('/api/waybills', waybillsRoutes);
  app.use('/api/invoices', invoicesRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/activity', activityRoutes);
  app.use('/api', balancesRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/expenses', expensesRoutes);
  app.use('/api/trips', tripsRoutes);
  app.use('/api/photos', photosRoutes);
  app.use('/api/export', exportExcelRoutes);
  app.use('/api/earnings', earningsRoutes);
  app.use('/api/salary', salaryRoutes);
  app.use('/api/backups', backupsRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/admin-registrations', adminRegistrationsRoutes);
  app.use('/api/driver-registrations', driverRegistrationsRoutes);

  app.use((err, _req, res, _next) => {
    console.error('[error]', err);
    res
      .status(err.status || 500)
      .json({ error: err.message || 'Внутренняя ошибка сервера' });
  });

  console.log('────────────────────────────────────────');
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Health: http://localhost:${PORT}/api/health`);
  console.log(`Data directory: ${require('./config/paths').DATA_DIR}`);
  const dbModule = require('./database');
  if (dbModule.kind === 'postgres') {
    console.log('Database: PostgreSQL (persistent cloud DB)');
  } else {
    console.log(`Database file: ${require('./config/paths').DB_PATH}`);
  }
  const lanIps = getLocalIpv4Addresses();
  if (lanIps.length > 0) {
    lanIps.forEach((ip) => {
      console.log(`Сервер доступен по адресу: http://${ip}:${PORT}`);
    });
  } else {
    console.log(`Сервер доступен по адресу: http://127.0.0.1:${PORT}`);
  }
  console.log('Тестовый админ: admin@test.com / admin123');
  const { getPublicSecurityConfig } = require('./utils/authPolicy');
  const authCfg = getPublicSecurityConfig();
  console.log('Auth security:', JSON.stringify(authCfg));
  console.log('Эндпоинты:');
  console.log('  POST   /api/auth/register');
  console.log('  POST   /api/auth/login');
  console.log('  GET    /api/auth/me');
  console.log('  GET    /api/driver-registrations (admin)');
  console.log('  GET    /api/admin-registrations (admin)');
  console.log('────────────────────────────────────────');

  const { startBackupScheduler } = require('./services/backup/backupScheduler');
  startBackupScheduler();
  if (typeof dbModule.startBackgroundReconnect === 'function') {
    dbModule.startBackgroundReconnect();
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[boot] Health port open on ${PORT}`);
  setImmediate(mountRoutes);
});
