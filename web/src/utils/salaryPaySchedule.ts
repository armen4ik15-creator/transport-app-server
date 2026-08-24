import { inferShiftFromRange, parseMonthKey } from './salaryPeriods';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function formatRuDate(isoDate: string): string {
  const match = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return isoDate;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

export function getShiftPayDueDate(year: number, month: number, shift: 1 | 2): string | null {
  if (shift === 1) {
    const lastDay = lastDayOfMonth(year, month);
    return `${year}-${pad2(month)}-${pad2(lastDay)}`;
  }

  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  return `${nextYear}-${pad2(nextMonth)}-15`;
}

export interface ShiftPaySchedule {
  shift: 1 | 2;
  monthValue: string;
  payDueDate: string;
  payDueLabel: string;
  rule: string;
}

export function getPayScheduleForPeriod(from: string, to: string): ShiftPaySchedule | null {
  const inferred = inferShiftFromRange(from, to);
  if (!inferred || inferred.shift === 'month') return null;

  const parsed = parseMonthKey(inferred.monthValue);
  if (!parsed) return null;

  const payDueDate = getShiftPayDueDate(parsed.year, parsed.month, inferred.shift);
  if (!payDueDate) return null;

  const rule =
    inferred.shift === 1
      ? 'Вахта 1 (1–15): выплата в последний день месяца вахты'
      : 'Вахта 2 (16–конец): выплата 15-го числа следующего месяца';

  return {
    shift: inferred.shift,
    monthValue: inferred.monthValue,
    payDueDate,
    payDueLabel: formatRuDate(payDueDate),
    rule,
  };
}

export function formatPayScheduleHint(from: string, to: string): string | null {
  const schedule = getPayScheduleForPeriod(from, to);
  if (!schedule) return null;
  return `Срок выплаты: ${schedule.payDueLabel} · ${schedule.rule}`;
}
