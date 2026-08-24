import { formatMoney } from './pagination';

export function formatDriverOwed(owed: number): string {
  if (owed > 0.01) return formatMoney(owed);
  return '0 ₽';
}

export function formatSalaryPeriodHint(
  firstTripDate: string | null | undefined,
  lastPaymentDate: string | null | undefined
): string {
  const parts: string[] = [];
  if (firstTripDate) parts.push(`рейсы с ${formatRuDateShort(firstTripDate)}`);
  if (lastPaymentDate) parts.push(`выплаты по ${formatRuDateShort(lastPaymentDate)}`);
  if (parts.length === 0) return 'нет рейсов и выплат в системе';
  return parts.join(', ');
}

function formatRuDateShort(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  if (!year || !month || !day) return iso;
  return `${day}.${month}.${year}`;
}

export function driverArchiveLabel(isArchived: number | boolean | undefined): string | null {
  return isArchived ? 'Архив' : null;
}
