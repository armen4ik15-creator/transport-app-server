/**
 * Единая классификация расходов для P&L, кассы и отчётов.
 *
 * Модель для транспортной компании:
 * - P&L (прибыль): операционные расходы периода + ЗП по рейсам
 * - р/с: реальные движения денег (method cash/noncash)
 * - ТК: пополнения (перевод актива) и заправки (расход с баланса карты)
 * - Вне P&L: возврат займа (приход), дивиденды (изъятие капитала), пополнения ТК
 */

/** Операционный расход P&L (включая заправки fuel). */
const OPERATING_P_AND_L_TYPES = new Set([
  'fuel',
  'repair',
  'parts',
  'maintenance',
  'platon',
  'wash',
  'toll',
  'fine',
  'dps',
  'supplies',
  'lease',
  'bank_fee',
  'other',
  'salary_other',
]);

/** Перевод р/с → топливный кошелёк (не расход P&L). */
const WALLET_TRANSFER_TYPES = new Set(['fuel_card']);

/** Приход денег / уменьшение обязательств (не расход P&L). */
const BALANCE_SHEET_INFLOW_TYPES = new Set(['loan_return']);

/** Изъятие капитала / распределение прибыли (не операционный расход P&L). */
const EQUITY_DISTRIBUTION_TYPES = new Set(['dividend']);

/** Типы, которые нельзя суммировать в «операционные расходы» P&L. */
const EXCLUDED_FROM_OPERATING_P_AND_L = new Set([
  ...WALLET_TRANSFER_TYPES,
  ...BALANCE_SHEET_INFLOW_TYPES,
  ...EQUITY_DISTRIBUTION_TYPES,
]);

function normalizeExpenseType(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase();
}

function isOperatingPnLExpenseType(expType) {
  const type = normalizeExpenseType(expType);
  if (!type) return true;
  if (EXCLUDED_FROM_OPERATING_P_AND_L.has(type)) return false;
  // Неизвестные типы по умолчанию считаем операционными (осторожнее завысить расход, чем скрыть).
  return true;
}

function isWalletTransferType(expType) {
  return WALLET_TRANSFER_TYPES.has(normalizeExpenseType(expType));
}

function isBalanceSheetInflowType(expType) {
  return BALANCE_SHEET_INFLOW_TYPES.has(normalizeExpenseType(expType));
}

function isEquityDistributionType(expType) {
  return EQUITY_DISTRIBUTION_TYPES.has(normalizeExpenseType(expType));
}

/**
 * @param {{ exp_type?: string|null, amount?: number|null, source?: string|null }[]} rows
 */
function summarizeExpensesForPnL(rows) {
  let operating = 0;
  let walletTransfers = 0;
  let balanceSheetInflows = 0;
  let equityDistributions = 0;
  let driverCompensations = 0;

  for (const row of rows || []) {
    const amount = Number(row?.amount);
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    const type = normalizeExpenseType(row?.exp_type);

    if (row?.source === 'driver') {
      driverCompensations += safeAmount;
    }

    if (isWalletTransferType(type)) {
      walletTransfers += safeAmount;
      continue;
    }
    if (isBalanceSheetInflowType(type)) {
      balanceSheetInflows += safeAmount;
      continue;
    }
    if (isEquityDistributionType(type)) {
      equityDistributions += safeAmount;
      continue;
    }
    operating += safeAmount;
  }

  return {
    operating,
    walletTransfers,
    balanceSheetInflows,
    equityDistributions,
    driverCompensations,
  };
}

/** SQL-фрагмент: исключить не-операционные типы из P&L. */
function operatingPnLExpenseSql(alias = 'e') {
  const excluded = [...EXCLUDED_FROM_OPERATING_P_AND_L]
    .map((t) => `'${t}'`)
    .join(', ');
  return `${alias}.exp_type NOT IN (${excluded})`;
}

module.exports = {
  OPERATING_P_AND_L_TYPES,
  WALLET_TRANSFER_TYPES,
  BALANCE_SHEET_INFLOW_TYPES,
  EQUITY_DISTRIBUTION_TYPES,
  EXCLUDED_FROM_OPERATING_P_AND_L,
  normalizeExpenseType,
  isOperatingPnLExpenseType,
  isWalletTransferType,
  isBalanceSheetInflowType,
  isEquityDistributionType,
  summarizeExpensesForPnL,
  operatingPnLExpenseSql,
};
