const ExcelJS = require('exceljs');
const db = require('../database');
const { summarizeExpensesForPnL } = require('./expenseClassification');

const COMPLETED_TRIP_SQL =
  "(t.status = 'completed' OR (t.status IS NULL AND t.stage = 'unloading'))";

const EXPENSE_TYPE_LABELS = {
  fuel_card: 'Пополнение топл. карты',
  fuel: 'Топливо по карте',
  repair: 'Ремонт/Шиномонтаж',
  parts: 'Запчасти/Шины',
  maintenance: 'ТО и сервис',
  platon: 'Платон',
  wash: 'Мойка',
  toll: 'Платные дороги',
  fine: 'Штрафы',
  dps: 'ДПС',
  supplies: 'Мелкие расходники',
  lease: 'Аренда/Лизинг',
  bank_fee: 'Банковские комиссии',
  other: 'Прочие расходы',
  salary_other: 'Зарплата (прочая)',
  dividend: 'Дивиденды',
  loan_return: 'Возврат займа (приход на р/с)',
};

const REGISTRY_HEADERS = [
  'Дата',
  '№ ТН',
  'Машина',
  'Водитель',
  'Материал',
  'Заказчик',
  'Отправитель',
  'Получатель',
  'Погрузка',
  'Выгрузка',
  'Расстояние км',
  'Ед. изм.',
  'Объём',
  'Ставка водителя',
  'Ставка за ед.',
  'Выручка',
];

function expenseStatusLabel(value) {
  if (!value || value === 'approved') return 'Одобрено';
  if (value === 'pending') return 'На проверке';
  if (value === 'rejected') return 'Отклонено';
  return value;
}

function expenseTypeLabel(value) {
  if (!value) return '';
  return EXPENSE_TYPE_LABELS[value] || value;
}

function expenseSourceLabel(value) {
  if (value === 'driver') return 'Водитель (компенсация)';
  if (value === 'system') return 'Система';
  return 'Админ';
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

function addHeaderRow(sheet, headers) {
  sheet.addRow(headers);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8EEF7' },
  };
}

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function tripRevenue(row) {
  return asNumber(row.total_volume) * asNumber(row.company_rate);
}

function tripDriverPay(row) {
  return asNumber(row.driver_rate);
}

function fetchCompletedTrips({ dateFrom, dateTo, driverId, vehiclePlate }) {
  const where = [COMPLETED_TRIP_SQL];
  const params = [];

  if (driverId) {
    where.push('t.driver_id = ?');
    params.push(driverId);
  }
  if (vehiclePlate) {
    where.push('(d.car_number = ? OR v.plate_number = ?)');
    params.push(vehiclePlate, vehiclePlate);
  }

  appendDateFilter(where, params, 'COALESCE(t.completed_at, t.created_at)', dateFrom, dateTo);

  return db
    .prepare(
      `SELECT
         date(COALESCE(t.completed_at, t.created_at)) AS row_date,
         t.ttn_number,
         COALESCE(v.plate_number, d.car_number, '') AS car_number,
         u.full_name AS driver_name,
         o.material,
         COALESCE(o.task_name, c.name, '') AS customer_name,
         COALESCE(o.sender, '') AS sender,
         COALESCE(o.receiver, '') AS receiver,
         o.load_address,
         o.unload_address,
         o.distance_km,
         o.driver_rate,
         o.company_rate,
         o.unit,
         COALESCE(t.volume, 0) AS total_volume,
         t.order_id
       FROM trips t
       JOIN orders o ON o.id = t.order_id
       JOIN drivers d ON d.id = t.driver_id
       LEFT JOIN users u ON u.id = d.user_id
       LEFT JOIN contractors c ON c.id = o.contractor_id
       LEFT JOIN vehicles v ON v.plate_number = d.car_number
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(t.completed_at, t.created_at) ASC, t.id ASC`
    )
    .all(...params);
}

function fetchExpenses({ dateFrom, dateTo, driverId }) {
  const where = ["(e.status IS NULL OR e.status = 'approved')"];
  const params = [];

  if (driverId) {
    where.push('e.driver_id = ?');
    params.push(driverId);
  }
  appendDateFilter(where, params, 'e.exp_date', dateFrom, dateTo);

  return db
    .prepare(
      `SELECT
         e.exp_date AS row_date,
         u.full_name AS driver_name,
         e.exp_type,
         e.amount,
         COALESCE(e.comment, '') AS comment,
         COALESCE(e.status, 'approved') AS status,
         COALESCE(e.source, 'admin') AS source
       FROM expenses e
       LEFT JOIN drivers d ON d.id = e.driver_id
       LEFT JOIN users u ON u.id = d.user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY e.exp_date ASC, e.id ASC`
    )
    .all(...params);
}

function resolveVehiclePlate(vehicleId) {
  if (!vehicleId || !Number.isFinite(vehicleId) || vehicleId <= 0) return null;
  const vehicle = db.prepare('SELECT plate_number FROM vehicles WHERE id = ?').get(vehicleId);
  return vehicle?.plate_number ?? null;
}

function addRegistryRows(sheet, rows) {
  let totalRevenue = 0;

  rows.forEach((row) => {
    const revenue = tripRevenue(row);
    totalRevenue += revenue;
    sheet.addRow([
      row.row_date ?? '',
      row.ttn_number ?? '',
      row.car_number ?? '',
      row.driver_name ?? '',
      row.material ?? '',
      row.customer_name ?? '',
      row.sender ?? '',
      row.receiver ?? '',
      row.load_address ?? '',
      row.unload_address ?? '',
      row.distance_km ?? '',
      row.unit ?? '',
      asNumber(row.total_volume),
      asNumber(row.driver_rate),
      asNumber(row.company_rate),
      revenue,
    ]);
  });

  sheet.addRow([
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'ИТОГО:',
    totalRevenue,
  ]);

  sheet.columns.forEach((column) => {
    column.width = 14;
  });

  return totalRevenue;
}

function buildRegistryWorkbook(tripRows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Реестр');
  addHeaderRow(sheet, REGISTRY_HEADERS);
  addRegistryRows(sheet, tripRows);
  return workbook;
}

function buildFinancialWorkbook(tripRows, expenseRows) {
  const workbook = new ExcelJS.Workbook();

  const tripsSheet = workbook.addWorksheet('Рейсы');
  addHeaderRow(tripsSheet, [...REGISTRY_HEADERS, 'Зарплата водителя']);

  let totalRevenue = 0;
  let totalDriverPay = 0;

  tripRows.forEach((row) => {
    const revenue = tripRevenue(row);
    const driverPay = tripDriverPay(row);
    totalRevenue += revenue;
    totalDriverPay += driverPay;
    tripsSheet.addRow([
      row.row_date ?? '',
      row.ttn_number ?? '',
      row.car_number ?? '',
      row.driver_name ?? '',
      row.material ?? '',
      row.customer_name ?? '',
      row.sender ?? '',
      row.receiver ?? '',
      row.load_address ?? '',
      row.unload_address ?? '',
      row.distance_km ?? '',
      row.unit ?? '',
      asNumber(row.total_volume),
      asNumber(row.driver_rate),
      asNumber(row.company_rate),
      revenue,
      driverPay,
    ]);
  });

  tripsSheet.columns.forEach((column) => {
    column.width = 14;
  });

  const expensesSheet = workbook.addWorksheet('Расходы');
  addHeaderRow(expensesSheet, [
    'Дата',
    'Водитель',
    'Тип расхода',
    'Сумма',
    'Статус',
    'Источник',
    'Комментарий',
  ]);

  expenseRows.forEach((row) => {
    const amount = asNumber(row.amount);
    expensesSheet.addRow([
      row.row_date ?? '',
      row.driver_name ?? '',
      expenseTypeLabel(row.exp_type),
      amount,
      expenseStatusLabel(row.status),
      expenseSourceLabel(row.source),
      row.comment ?? '',
    ]);
  });

  const classified = summarizeExpensesForPnL(expenseRows);
  const operatingExpenses = classified.operating;
  const driverCompensations = classified.driverCompensations;
  const totalCosts = operatingExpenses + totalDriverPay;
  const profit = totalRevenue - totalCosts;

  expensesSheet.addRow([]);
  expensesSheet.addRow([
    '',
    '',
    'Итого операционных расходов (P&L)',
    operatingExpenses,
    '',
    '',
    'без пополнений ТК, возврата займа и дивидендов',
  ]);
  expensesSheet.addRow([
    '',
    '',
    'Зарплата водителя (из рейсов)',
    totalDriverPay,
    '',
    '',
    `${tripRows.length} рейсов`,
  ]);
  if (classified.walletTransfers > 0) {
    expensesSheet.addRow([
      '',
      '',
      'Пополнения ТК (не P&L, перевод актива)',
      classified.walletTransfers,
      '',
      '',
      '',
    ]);
  }
  if (classified.balanceSheetInflows > 0) {
    expensesSheet.addRow([
      '',
      '',
      'Возврат займа / приходы (не расход)',
      classified.balanceSheetInflows,
      '',
      '',
      '',
    ]);
  }
  if (classified.equityDistributions > 0) {
    expensesSheet.addRow([
      '',
      '',
      'Дивиденды (не операционный расход)',
      classified.equityDistributions,
      '',
      '',
      '',
    ]);
  }

  const profitSheet = workbook.addWorksheet('Прибыль');
  addHeaderRow(profitSheet, ['Показатель', 'Сумма, ₽']);
  profitSheet.addRow(['Выручка (из рейсов)', totalRevenue]);
  profitSheet.addRow(['Операционные расходы (P&L)', operatingExpenses]);
  if (driverCompensations > 0) {
    profitSheet.addRow(['в т.ч. компенсации водителям', driverCompensations]);
  }
  profitSheet.addRow(['Зарплата водителей (из рейсов)', totalDriverPay]);
  profitSheet.addRow(['Итого расходов (P&L)', totalCosts]);
  profitSheet.addRow(['Прибыль (P&L)', profit]);
  if (classified.walletTransfers > 0) {
    profitSheet.addRow(['Справочно: пополнения ТК (не в прибыли)', classified.walletTransfers]);
  }
  if (classified.balanceSheetInflows > 0) {
    profitSheet.addRow(['Справочно: возврат займа / приходы', classified.balanceSheetInflows]);
  }
  if (classified.equityDistributions > 0) {
    profitSheet.addRow(['Справочно: дивиденды', classified.equityDistributions]);
  }
  profitSheet.columns.forEach((column) => {
    column.width = 42;
  });

  return workbook;
}

async function workbookToBuffer(workbook) {
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = {
  REGISTRY_HEADERS,
  EXPENSE_TYPE_LABELS,
  expenseStatusLabel,
  expenseTypeLabel,
  expenseSourceLabel,
  addHeaderRow,
  asNumber,
  tripRevenue,
  tripDriverPay,
  fetchCompletedTrips,
  fetchExpenses,
  resolveVehiclePlate,
  addRegistryRows,
  buildRegistryWorkbook,
  buildFinancialWorkbook,
  workbookToBuffer,
};
