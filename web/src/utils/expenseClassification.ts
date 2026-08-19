const WALLET_TRANSFER_TYPES = new Set(['fuel_card']);
const BALANCE_SHEET_INFLOW_TYPES = new Set(['loan_return']);
const EQUITY_DISTRIBUTION_TYPES = new Set(['dividend']);

function normalizeExpenseType(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .toLowerCase();
}

export function isOperatingPnLExpenseType(expType: string | null | undefined): boolean {
  const type = normalizeExpenseType(expType);
  if (!type) return true;
  if (WALLET_TRANSFER_TYPES.has(type)) return false;
  if (BALANCE_SHEET_INFLOW_TYPES.has(type)) return false;
  if (EQUITY_DISTRIBUTION_TYPES.has(type)) return false;
  return true;
}

export function summarizeExpensesForPnL(
  rows: Array<{ exp_type?: string | null; amount?: number | null; source?: string | null }>
) {
  let operating = 0;
  let walletTransfers = 0;
  let balanceSheetInflows = 0;
  let equityDistributions = 0;

  for (const row of rows) {
    const amount = Number(row.amount);
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    const type = normalizeExpenseType(row.exp_type);

    if (WALLET_TRANSFER_TYPES.has(type)) {
      walletTransfers += safeAmount;
      continue;
    }
    if (BALANCE_SHEET_INFLOW_TYPES.has(type)) {
      balanceSheetInflows += safeAmount;
      continue;
    }
    if (EQUITY_DISTRIBUTION_TYPES.has(type)) {
      equityDistributions += safeAmount;
      continue;
    }
    operating += safeAmount;
  }

  return { operating, walletTransfers, balanceSheetInflows, equityDistributions };
}

export function summarizeExpensesByType(
  rows: Array<{ exp_type?: string | null; amount?: number | null }>
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const key = normalizeExpenseType(row.exp_type) || 'other';
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    totals[key] = (totals[key] ?? 0) + amount;
  }
  return totals;
}
