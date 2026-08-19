export type ReportPeriod = 'month' | 'quarter' | 'year';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function getReportPeriodBounds(period: ReportPeriod, anchor = new Date()): { from: string; to: string } {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();

  if (period === 'year') {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }

  if (period === 'quarter') {
    const quarterStartMonth = Math.floor(month / 3) * 3;
    const start = new Date(year, quarterStartMonth, 1);
    const end = new Date(year, quarterStartMonth + 3, 0);
    return { from: toIsoDate(start), to: toIsoDate(end) };
  }

  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  return { from: toIsoDate(start), to: toIsoDate(end) };
}

export function isFutureDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return value > todayIso();
}
