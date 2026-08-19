import type { DriverPaymentMethod, DriverPaymentType } from '../types';

export const PAYMENT_TYPE_OPTIONS: { value: DriverPaymentType; label: string }[] = [
  { value: 'salary', label: 'Зарплата' },
  { value: 'advance', label: 'Аванс' },
  { value: 'bonus', label: 'Бонус' },
  { value: 'deduction', label: 'Удержание' },
];

export const PAYMENT_METHOD_OPTIONS: { value: DriverPaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Наличные' },
  { value: 'noncash', label: 'Безналичные' },
];

export function getPaymentTypeLabel(type: DriverPaymentType): string {
  return PAYMENT_TYPE_OPTIONS.find((item) => item.value === type)?.label ?? type;
}

export function getPaymentMethodLabel(method: DriverPaymentMethod | null | undefined): string {
  if (!method) return '—';
  return PAYMENT_METHOD_OPTIONS.find((item) => item.value === method)?.label ?? method;
}

export function accrualStatusLabel(debt: number): string {
  if (debt > 0.01) return 'Есть долг';
  if (debt < -0.01) return 'Переплата';
  return 'Закрыто';
}
