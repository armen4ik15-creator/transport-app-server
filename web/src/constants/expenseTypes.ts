export interface ExpenseTypeOption {
  value: string;
  label: string;
}

export const ALL_EXPENSE_TYPES: ExpenseTypeOption[] = [
  { value: 'fuel', label: 'Топливо' },
  { value: 'fuel_card', label: 'Пополнение ТК' },
  { value: 'repair', label: 'Ремонт' },
  { value: 'parts', label: 'Запчасти' },
  { value: 'maintenance', label: 'ТО' },
  { value: 'platon', label: 'Платон' },
  { value: 'wash', label: 'Мойка' },
  { value: 'toll', label: 'Платная дорога' },
  { value: 'fine', label: 'Штраф' },
  { value: 'dps', label: 'ДПС / ГИБДД' },
  { value: 'supplies', label: 'Расходники' },
  { value: 'lease', label: 'Аренда' },
  { value: 'bank_fee', label: 'Банк / комиссия' },
  { value: 'salary_other', label: 'Зарплата / прочее' },
  { value: 'loan_return', label: 'Возврат займа (приход)' },
  { value: 'dividend', label: 'Дивиденды' },
  { value: 'other', label: 'Прочее' },
];

const labelMap = new Map(ALL_EXPENSE_TYPES.map((item) => [item.value, item.label]));

export function getExpenseTypeLabel(expType: string | null | undefined): string {
  if (!expType) return 'Прочее';
  return labelMap.get(expType) ?? expType;
}

export const EXPENSE_METHOD_OPTIONS = [
  { value: 'noncash', label: 'Безнал (р/с)' },
  { value: 'cash', label: 'Наличные / касса' },
  { value: 'none', label: 'Только P&L (без р/с)' },
] as const;

export function getExpenseMethodLabel(method: string | null | undefined): string {
  if (!method || method === 'none') return 'Только P&L';
  if (method === 'cash') return 'Наличные';
  if (method === 'noncash') return 'Безнал';
  return method;
}
