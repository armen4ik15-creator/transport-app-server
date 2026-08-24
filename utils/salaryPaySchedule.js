/**
 * Сроки выплаты зарплаты по вахтам:
 * - Вахта 1 (1–15): последний день месяца вахты (28/29 фев, 30/31 и т.д.)
 * - Вахта 2 (16–конец): 15-е число следующего месяца
 */

const { formatRuDate } = require('./salaryCalculations');

function pad2(value) {
  return String(value).padStart(2, '0');
}

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function parseMonthKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, month };
}

function inferShiftFromRange(from, to) {
  const fromMatch = String(from || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const toMatch = String(to || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!fromMatch || !toMatch) return null;
  if (fromMatch[1] !== toMatch[1] || fromMatch[2] !== toMatch[2]) {
    return { monthValue: `${fromMatch[1]}-${fromMatch[2]}`, shift: 'month' };
  }

  const year = Number(fromMatch[1]);
  const month = Number(fromMatch[2]);
  const fromDay = Number(fromMatch[3]);
  const toDay = Number(toMatch[3]);
  const lastDay = lastDayOfMonth(year, month);
  const monthValue = `${year}-${pad2(month)}`;

  if (fromDay === 1 && toDay === 15) return { monthValue, shift: 1 };
  if (fromDay === 16 && toDay === lastDay) return { monthValue, shift: 2 };
  if (fromDay === 1 && toDay === lastDay) return { monthValue, shift: 'month' };
  return { monthValue, shift: 'month' };
}

function getShiftPayDueDate(year, month, shift) {
  if (shift !== 1 && shift !== 2) return null;

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

function getPayScheduleForPeriod(from, to) {
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
    month_value: inferred.monthValue,
    pay_due_date: payDueDate,
    pay_due_label: formatRuDate(payDueDate),
    pay_schedule_rule: rule,
  };
}

function formatPayScheduleHint(from, to) {
  const schedule = getPayScheduleForPeriod(from, to);
  if (!schedule) return null;
  return `Срок выплаты: ${schedule.pay_due_label} · ${schedule.pay_schedule_rule}`;
}

module.exports = {
  getShiftPayDueDate,
  getPayScheduleForPeriod,
  formatPayScheduleHint,
  inferShiftFromRange,
};
