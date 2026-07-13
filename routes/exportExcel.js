const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../database');
const { buildSalaryTimesheetWorkbook } = require('../utils/salaryExport');
const {
  REGISTRY_HEADERS,
  expenseStatusLabel,
  expenseTypeLabel,
  expenseSourceLabel,
  addHeaderRow,
  asNumber,
  tripDriverPay,
  fetchCompletedTrips,
  fetchExpenses,
  resolveVehiclePlate,
  addRegistryRows,
  buildFinancialWorkbook,
} = require('../utils/transportExports');

const router = express.Router();

function getDriverIdForUser(userId) {
  const row = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(userId);
  return row ? row.id : null;
}

function resolveDriverScope(req) {
  const requested = req.query.driver_id ? Number(req.query.driver_id) : null;
  if (req.user.role !== 'admin') {
    return getDriverIdForUser(req.user.id);
  }
  return Number.isFinite(requested) && requested > 0 ? requested : null;
}

function readDateRange(req) {
  return {
    dateFrom: req.query.date_from ? String(req.query.date_from) : null,
    dateTo: req.query.date_to ? String(req.query.date_to) : null,
  };
}

async function sendWorkbook(res, workbook, filename) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(filename)}"`
  );
  await workbook.xlsx.write(res);
  res.end();
}

router.get('/registry', async (req, res) => {
  try {
    const { dateFrom, dateTo } = readDateRange(req);
    const driverId = resolveDriverScope(req);
    const vehicleId = req.query.vehicle_id ? Number(req.query.vehicle_id) : null;
    const vehiclePlate = resolveVehiclePlate(vehicleId);

    const rows = fetchCompletedTrips({ dateFrom, dateTo, driverId, vehiclePlate });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Реестр');
    addHeaderRow(sheet, REGISTRY_HEADERS);
    addRegistryRows(sheet, rows);

    const suffix = vehiclePlate ? 'по_машине' : 'общий';
    await sendWorkbook(res, workbook, `реестр_перевозок_${suffix}.xlsx`);
  } catch (error) {
    console.error('[export/registry]', error);
    res.status(500).json({ error: 'Не удалось сформировать реестр' });
  }
});

router.get('/financial-report', async (req, res) => {
  try {
    const { dateFrom, dateTo } = readDateRange(req);
    const driverId = resolveDriverScope(req);
    const vehicleId = req.query.vehicle_id ? Number(req.query.vehicle_id) : null;
    const vehiclePlate = resolveVehiclePlate(vehicleId);

    const tripRows = fetchCompletedTrips({ dateFrom, dateTo, driverId, vehiclePlate });
    const expenseRows = fetchExpenses({ dateFrom, dateTo, driverId });

    const workbook = buildFinancialWorkbook(tripRows, expenseRows);
    const suffix = vehiclePlate ? 'по_машине' : 'общий';
    await sendWorkbook(res, workbook, `финансовый_отчёт_${suffix}.xlsx`);
  } catch (error) {
    console.error('[export/financial-report]', error);
    res.status(500).json({ error: 'Не удалось сформировать финансовый отчёт' });
  }
});

router.get('/finances', async (req, res) => {
  try {
    const { dateFrom, dateTo } = readDateRange(req);
    const driverId = resolveDriverScope(req);
    const vehicleId = req.query.vehicle_id ? Number(req.query.vehicle_id) : null;
    const vehiclePlate = resolveVehiclePlate(vehicleId);

    const tripRows = fetchCompletedTrips({ dateFrom, dateTo, driverId, vehiclePlate });
    const expenseRows = fetchExpenses({ dateFrom, dateTo, driverId });
    const workbook = buildFinancialWorkbook(tripRows, expenseRows);

    await sendWorkbook(res, workbook, 'финансовый_отчёт.xlsx');
  } catch (error) {
    console.error('[export/finances]', error);
    res.status(500).json({ error: 'Не удалось сформировать финансовый отчёт' });
  }
});

router.get('/expenses', async (req, res) => {
  try {
    const { dateFrom, dateTo } = readDateRange(req);
    const driverId = resolveDriverScope(req);
    const expenseRows = fetchExpenses({ dateFrom, dateTo, driverId });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Расходы');
    addHeaderRow(sheet, [
      'Дата',
      'Водитель',
      'Тип расхода',
      'Сумма',
      'Статус',
      'Источник',
      'Комментарий',
    ]);

    expenseRows.forEach((row) => {
      sheet.addRow([
        row.row_date ?? '',
        row.driver_name ?? '',
        expenseTypeLabel(row.exp_type),
        asNumber(row.amount),
        expenseStatusLabel(row.status),
        expenseSourceLabel(row.source),
        row.comment ?? '',
      ]);
    });

    await sendWorkbook(res, workbook, 'расходы.xlsx');
  } catch (error) {
    console.error('[export/expenses]', error);
    res.status(500).json({ error: 'Не удалось сформировать отчёт по расходам' });
  }
});

router.get('/earnings', async (req, res) => {
  try {
    const { dateFrom, dateTo } = readDateRange(req);
    const driverId = resolveDriverScope(req);
    const tripRows = fetchCompletedTrips({ dateFrom, dateTo, driverId, vehiclePlate: null });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Начисления');
    addHeaderRow(sheet, ['Дата', 'Водитель', 'Сумма', 'Заказ', 'ТТН']);

    tripRows.forEach((row) => {
      sheet.addRow([
        row.row_date ?? '',
        row.driver_name ?? '',
        tripDriverPay(row),
        row.order_id ?? '',
        row.ttn_number ?? '',
      ]);
    });

    await sendWorkbook(res, workbook, 'начисления.xlsx');
  } catch (error) {
    console.error('[export/earnings]', error);
    res.status(500).json({ error: 'Не удалось сформировать отчёт по начислениям' });
  }
});

router.get('/salary', async (req, res) => {
  try {
    const { dateFrom, dateTo } = readDateRange(req);
    const driverId = resolveDriverScope(req);
    const workbook = buildSalaryTimesheetWorkbook(db, { dateFrom, dateTo, driverId });
    await sendWorkbook(res, workbook, 'зарплатный_табель.xlsx');
  } catch (error) {
    console.error('[export/salary]', error);
    res.status(500).json({ error: 'Не удалось сформировать зарплатный табель' });
  }
});

module.exports = router;
