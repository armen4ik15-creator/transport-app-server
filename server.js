require('dotenv').config();
const path = require('path');
const os = require('os');
const compression = require('compression');
const cors = require('cors');
const { authMiddleware } = require('./middleware/auth');
const { UPLOADS_DIR, ensureDataStorage } = require('./config/paths');

ensureDataStorage();
require('./database');

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


app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res
    .status(err.status || 500)
    .json({ error: err.message || 'Р’РЅСѓС‚СЂРµРЅРЅСЏСЏ РѕС€РёР±РєР° СЃРµСЂРІРµСЂР°' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ');
  console.log(`РЎРµСЂРІРµСЂ Р·Р°РїСѓС‰РµРЅ РЅР° РїРѕСЂС‚Сѓ ${PORT}`);
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
      console.log(`РЎРµСЂРІРµСЂ РґРѕСЃС‚СѓРїРµРЅ РїРѕ Р°РґСЂРµСЃСѓ: http://${ip}:${PORT}`);
    });
  } else {
    console.log(`РЎРµСЂРІРµСЂ РґРѕСЃС‚СѓРїРµРЅ РїРѕ Р°РґСЂРµСЃСѓ: http://127.0.0.1:${PORT}`);
  }
  console.log('РўРµСЃС‚РѕРІС‹Р№ Р°РґРјРёРЅ: admin@test.com / admin123');
  const { getPublicSecurityConfig } = require('./utils/authPolicy');
  const authCfg = getPublicSecurityConfig();
  console.log('Auth security:', JSON.stringify(authCfg));
  console.log('Р­РЅРґРїРѕРёРЅС‚С‹:');
  console.log('  POST   /api/auth/register');
  console.log('  POST   /api/auth/login');
  console.log('  GET    /api/auth/me');
  console.log('  GET    /api/drivers           (admin: РІСЃРµ, driver: СЃРµР±СЏ)');
  console.log('  POST   /api/drivers           (admin)');
  console.log('  PUT    /api/drivers/:id       (admin)');
  console.log('  DELETE /api/drivers/:id       (admin)');
  console.log('  GET    /api/contractors       (admin)');
  console.log('  POST   /api/contractors       (admin)');
  console.log('  PUT    /api/contractors/:id   (admin)');
  console.log('  DELETE /api/contractors/:id   (admin)');
  console.log('  GET    /api/orders            (admin: РІСЃРµ, driver: СЃРІРѕРё)');
  console.log('  GET    /api/orders/:id        (admin/owner)');
  console.log('  POST   /api/orders            (admin)');
  console.log('  PUT    /api/orders/:id/status (driver вЂ” РґР»СЏ СЃРІРѕРёС…)');
  console.log('  POST   /api/orders/:id/photos (multipart, owner/admin)');
  console.log('  GET    /api/finances          (admin: РІСЃРµ, driver: СЃРІРѕРё)');
  console.log('  POST   /api/finances          (admin)');
  console.log('  GET    /api/drivers/:id/balance (admin/owner)');
  console.log('  GET    /api/documents         (admin: РІСЃРµ, driver: СЃРІРѕРё)');
  console.log('  POST   /api/documents         (multipart, admin/owner)');
  console.log('  DELETE /api/documents/:id     (admin/author)');
  console.log('  GET    /api/templates         (admin)');
  console.log('  POST   /api/templates         (admin)');
  console.log('  PUT    /api/templates/:id     (admin)');
  console.log('  DELETE /api/templates/:id     (admin)');
  console.log('  GET    /api/order-templates   (admin)');
  console.log('  POST   /api/order-templates   (admin)');
  console.log('  POST   /api/order-templates/from-order (admin)');
  console.log('  PUT    /api/order-templates/:id (admin)');
  console.log('  DELETE /api/order-templates/:id (admin)');
  console.log('  GET/POST/PUT/DELETE /api/materials (admin CRUD, read all)');
  console.log('  GET/POST/PUT/DELETE /api/vehicles  (admin CRUD, read all)');
  console.log('  GET/POST/PUT/DELETE /api/waybills  (admin: РІСЃРµ, driver: СЃРІРѕРё)');
  console.log('  GET/POST/PUT/DELETE /api/invoices  (admin: РІСЃРµ, driver: СЃРІРѕРё)');
  console.log('  GET/POST/PUT/DELETE /api/notifications (admin/owner)');
  console.log('  GET    /api/activity          (admin: РІСЃС‘, driver: СЃРІРѕРё РґРµР№СЃС‚РІРёСЏ)');
  console.log('  GET    /api/reports/summary   (admin: РІСЃРµ/С„РёР»СЊС‚СЂ, driver: СЃРІРѕРё)');
  console.log('  GET    /api/expenses          (admin: РІСЃРµ/С„РёР»СЊС‚СЂ, driver: СЃРІРѕРё)');
  console.log('  POST   /api/expenses          (admin/driver)');
  console.log('  GET    /api/trips             (admin: РІСЃРµ, driver: СЃРІРѕРё)');
  console.log('  POST   /api/trips             (multipart/json, admin/owner)');
  console.log('  GET    /api/photos            (admin: РІСЃРµ, driver: СЃРІРѕРё Р·Р°РєР°Р·С‹)');
  console.log('  GET    /api/export/registry          (Excel СЂРµРµСЃС‚СЂ РїРµСЂРµРІРѕР·РѕРє)');
  console.log('  GET    /api/export/financial-report    (Excel: СЂРµР№СЃС‹ + СЂР°СЃС…РѕРґС‹ + РїСЂРёР±С‹Р»СЊ)');
  console.log('  GET    /api/export/finances            (alias financial-report)');
  console.log('  GET    /api/export/expenses   (Excel СЂР°СЃС…РѕРґС‹)');
  console.log('  GET    /api/export/earnings   (Excel РЅР°С‡РёСЃР»РµРЅРёСЏ)');
  console.log('  GET    /api/export/salary     (Excel Р·Р°СЂРїР»Р°С‚Р°)');
  console.log('  GET    /api/earnings/summary  (admin: РІСЃРµ/С„РёР»СЊС‚СЂ, driver: СЃРІРѕРё)');
  console.log('  GET    /api/salary/payments   (admin)');
  console.log('  POST   /api/salary/payments   (admin)');
  console.log('  DELETE /api/salary/payments/:id (admin)');
  console.log('  GET    /api/salary/summary    (admin, driver_id РѕР±СЏР·Р°С‚РµР»РµРЅ)');
  console.log('  GET    /api/salary/debts      (admin)');
  console.log('  GET    /api/contractors/payments (admin)');
  console.log('  POST   /api/contractors/payments (admin)');
  console.log('  DELETE /api/contractors/payments/:id (admin)');
  console.log('  GET    /api/contractors/summary (admin)');
  console.log('  DELETE /api/expenses/:id      (admin/owner)');
  console.log('в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ');
  const { startBackupScheduler } = require('./services/backup/backupScheduler');
  startBackupScheduler();
});