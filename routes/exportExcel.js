const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../database');

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

function appendDateFilter(where, params, column, dateFrom, dateTo) {
  if (dateFrom) {
    where.push(`date(${column}) >= date(?)`);
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push(`date(${column}) <= date(?)`);
    params.push(dateTo);
  }
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

function addHeaderRow(sheet, headers) {
  sheet.addRow(headers);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
}

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

router.get('/registry', async (req, res) => {
  try {
    const { dateFrom, dateTo } = readDateRange(req);
    const driverId = resolveDriverScope(req);
    const vehicleId = req.query.vehicle_id ? Number(req.query.vehicle_id) : null;

    const where = ["(t.status = 'completed' OR (t.status IS NULL AND t.stage = 'unloading'))"];
    const params = [];

    if (driverId) {
      where.push('t.driver_id = ?');
      params.push(driverId);
    }
    if (vehicleId && Number.isFinite(vehicleId) && vehicleId > 0) {
      const vehicle = db.prepare('SELECT plate_number FROM vehicles WHERE id = ?').get(vehicleId);
      if (vehicle?.plate_number) {
        where.push('(d.car_number = ? OR v.plate_number = ?)');
        params.push(vehicle.plate_number, vehicle.plate_number);
      }
    }

    appendDateFilter(where, params, 't.created_at', dateFrom, dateTo);

    const rows = db
      .prepare(
        `SELECT
           date(t.created_at) AS row_date,
           t.ttn_number,
           COALESCE(v.plate_number, d.car_number, '') AS car_number,
           u.full_name AS driver_name,
           o.material,
           c.name AS contractor_name,
           o.load_address,
           o.unload_address,
           o.distance_km,
           o.driver_rate,
           o.company_rate,
           o.unit,
           COALESCE(t.volume, 0) AS total_volume
         FROM trips t
         JOIN orders o ON o.id = t.order_id
         JOIN drivers d ON d.id = t.driver_id
         LEFT JOIN users u ON u.id = d.user_id
         LEFT JOIN contractors c ON c.id = o.contractor_id
         LEFT JOIN vehicles v ON v.plate_number = d.car_number
         WHERE ${where.join(' AND ')}
         ORDER BY t.created_at ASC, t.id ASC`
      )
      .all(...params);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Реестр');
    addHeaderRow(sheet, [
      'Дата',
      'Номер ТН',
      'Номер машины',
      'ФИО водителя',
      'Материал',
      'Контрагент',
      'Погрузка',
      'Выгрузка',
      'Плечо, км',
      'Ставка водителя',
      'Ставка за м3/т',
      'Ед. изм.',
      'Всего',
      'Сумма',
      'Налог',
    ]);

    rows.forEach((row) => {
      const total = asNumber(row.total_volume);
      const rate = asNumber(row.company_rate);
      const sum = total * rate;
      const tax = sum * 0.13;
      sheet.addRow([
        row.row_date ?? '',
        row.ttn_number ?? '',
        row.car_number ?? '',
        row.driver_name ?? '',
        row.material ?? '',
        row.contractor_name ?? '',
        row.load_address ?? '',
        row.unload_address ?? '',
        row.distance_km ?? '',
        row.driver_rate ?? '',
        row.company_rate ?? '',
        row.unit ?? '',
        total,
        sum,
        tax,
      ]);
    });

    sheet.columns.forEach((column) => {
      column.width = 16;
    });

    const suffix = vehicleId ? 'по_машине' : 'общий';
    await sendWorkbook(res, workbook, `реестр_перевозок_${suffix}.xlsx`);
  } catch (error) {
    console.error('[export/registry]', error);
    res.status(500).json({ error: 'Не удалось сформировать реестр' });
  }
});

router.get('/finances', async (req, res) => {
  try {
    const { dateFrom, dateTo } = readDateRange(req);
    const driverId = resolveDriverScope(req);
    const where = [];
    const params = [];

    if (driverId) {
      where.push('f.driver_id = ?');
      params.push(driverId);
    }
    appendDateFilter(where, params, 'f.created_at', dateFrom, dateTo);

    const rows = db
      .prepare(
        `SELECT
           date(f.created_at) AS row_date,
           u.full_name AS driver_name,
           f.type,
           f.amount,
           COALESCE(f.description, '') AS description
         FROM finances f
         JOIN drivers d ON d.id = f.driver_id
         JOIN users u ON u.id = d.user_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY f.created_at ASC, f.id ASC`
      )
      .all(...params);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Финансы');
    addHeaderRow(sheet, ['Дата', 'Водитель', 'Тип операции', 'Сумма', 'Основание']);

    const typeLabels = { income: 'Доход', expense: 'Расход' };
    rows.forEach((row) => {
      sheet.addRow([
        row.row_date ?? '',
        row.driver_name ?? '',
        typeLabels[row.type] ?? row.type,
        asNumber(row.amount),
        row.description ?? '',
      ]);
    });

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
    const where = [];
    const params = [];

    if (driverId) {
      where.push('e.driver_id = ?');
      params.push(driverId);
    }
    appendDateFilter(where, params, 'e.exp_date', dateFrom, dateTo);

    const rows = db
      .prepare(
        `SELECT
           e.exp_date AS row_date,
           u.full_name AS driver_name,
           e.exp_type,
           e.amount,
           COALESCE(e.comment, '') AS comment
         FROM expenses e
         LEFT JOIN drivers d ON d.id = e.driver_id
         LEFT JOIN users u ON u.id = d.user_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY e.exp_date ASC, e.id ASC`
      )
      .all(...params);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Расходы');
    addHeaderRow(sheet, ['Дата', 'Водитель', 'Тип расхода', 'Сумма', 'Комментарий']);

    rows.forEach((row) => {
      sheet.addRow([
        row.row_date ?? '',
        row.driver_name ?? '',
        row.exp_type ?? '',
        asNumber(row.amount),
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
    const where = ["(t.status = 'completed' OR (t.status IS NULL AND t.stage = 'unloading'))"];
    const params = [];

    if (driverId) {
      where.push('t.driver_id = ?');
      params.push(driverId);
    }
    appendDateFilter(where, params, 't.created_at', dateFrom, dateTo);

    const rows = db
      .prepare(
        `SELECT
           date(t.created_at) AS row_date,
           u.full_name AS driver_name,
           COALESCE(o.driver_rate, 0) AS amount,
           t.order_id
         FROM trips t
         JOIN orders o ON o.id = t.order_id
         JOIN drivers d ON d.id = t.driver_id
         LEFT JOIN users u ON u.id = d.user_id
         WHERE ${where.join(' AND ')}
         ORDER BY t.created_at ASC, t.id ASC`
      )
      .all(...params);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Начисления');
    addHeaderRow(sheet, ['Дата', 'Водитель', 'Сумма', 'Заказ']);

    rows.forEach((row) => {
      sheet.addRow([
        row.row_date ?? '',
        row.driver_name ?? '',
        asNumber(row.amount),
        row.order_id ?? '',
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

    const driversQuery = driverId
      ? db.prepare('SELECT d.id, u.full_name AS driver_name FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.id = ?').all(driverId)
      : db.prepare('SELECT d.id, u.full_name AS driver_name FROM drivers d JOIN users u ON u.id = d.user_id ORDER BY u.full_name ASC').all();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Зарплата');
    addHeaderRow(sheet, ['Водитель', 'Начислено', 'Удержано', 'К выплате']);

    driversQuery.forEach((driver) => {
      const financeWhere = ['driver_id = ?'];
      const financeParams = [driver.id];
      appendDateFilter(financeWhere, financeParams, 'created_at', dateFrom, dateTo);

      const financeStats = db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income,
             COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense
           FROM finances
           WHERE ${financeWhere.join(' AND ')}`
        )
        .get(...financeParams);

      const paymentWhere = ['driver_id = ?'];
      const paymentParams = [driver.id];
      appendDateFilter(paymentWhere, paymentParams, 'created_at', dateFrom, dateTo);

      const paymentStats = db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN type IN ('salary','advance','bonus') THEN amount END), 0) AS paid,
             COALESCE(SUM(CASE WHEN type = 'deduction' THEN amount END), 0) AS deducted
           FROM driver_payments
           WHERE ${paymentWhere.join(' AND ')}`
        )
        .get(...paymentParams);

      const accrued = asNumber(financeStats.income) - asNumber(financeStats.expense);
      const deducted = asNumber(paymentStats.deducted);
      const paid = asNumber(paymentStats.paid);
      const toPay = accrued + deducted - paid;

      sheet.addRow([driver.driver_name ?? `#${driver.id}`, accrued, deducted, toPay]);
    });

    await sendWorkbook(res, workbook, 'зарплатная_ведомость.xlsx');
  } catch (error) {
    console.error('[export/salary]', error);
    res.status(500).json({ error: 'Не удалось сформировать зарплатную ведомость' });
  }
});

module.exports = router;
