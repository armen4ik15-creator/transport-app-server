require('dotenv').config();
const path = require('path');
const os = require('os');
const express = require('express');
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
  console.log(`Data directory: ${require('./config/paths').DATA_DIR}`);
  console.log(`Database file: ${require('./config/paths').DB_PATH}`);
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
  console.log('  GET/POST/PUT/DELETE /api/waybills  (admin: все, driver: свои)');
  console.log('  GET/POST/PUT/DELETE /api/invoices  (admin: все, driver: свои)');
  console.log('  GET/POST/PUT/DELETE /api/notifications (admin/owner)');
  console.log('  GET    /api/activity          (admin: всё, driver: свои действия)');
  console.log('  GET    /api/reports/summary   (admin: все/фильтр, driver: свои)');
  console.log('  GET    /api/expenses          (admin: все/фильтр, driver: свои)');
  console.log('  POST   /api/expenses          (admin/driver)');
  console.log('  GET    /api/trips             (admin: все, driver: свои)');
  console.log('  POST   /api/trips             (multipart/json, admin/owner)');
  console.log('  GET    /api/photos            (admin: все, driver: свои заказы)');
  console.log('  GET    /api/export/registry   (Excel реестр перевозок)');
  console.log('  GET    /api/export/finances   (Excel финансы)');
  console.log('  GET    /api/export/expenses   (Excel расходы)');
  console.log('  GET    /api/export/earnings   (Excel начисления)');
  console.log('  GET    /api/export/salary     (Excel зарплата)');
  console.log('  GET    /api/earnings/summary  (admin: все/фильтр, driver: свои)');
  console.log('  GET    /api/salary/payments   (admin)');
  console.log('  POST   /api/salary/payments   (admin)');
  console.log('  DELETE /api/salary/payments/:id (admin)');
  console.log('  GET    /api/salary/summary    (admin, driver_id обязателен)');
  console.log('  GET    /api/salary/debts      (admin)');
  console.log('  GET    /api/contractors/payments (admin)');
  console.log('  POST   /api/contractors/payments (admin)');
  console.log('  DELETE /api/contractors/payments/:id (admin)');
  console.log('  GET    /api/contractors/summary (admin)');
  console.log('  DELETE /api/expenses/:id      (admin/owner)');
  console.log('────────────────────────────────────────');
});
