/**
 * Периоды вахт для зарплаты — как в мобильном приложении (lib/dates.ts).
 * Вахта 1: 1–15, вахта 2: 16 — последний день месяца.
 */

function pad2(value) {
  return String(value).padStart(2, '0');
}

function lastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function shiftPeriodBounds(year, month, shift) {
  const monthNum = Number(month);
  const yearNum = Number(year);
  if (!Number.isFinite(yearNum) || !Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) {
    return null;
  }
  if (shift !== 1 && shift !== 2) return null;

  const monthLabel = `${yearNum}-${pad2(monthNum)}`;
  if (shift === 1) {
    return {
      shift,
      year: yearNum,
      month: monthNum,
      monthLabel,
      dateFrom: `${monthLabel}-01`,
      dateTo: `${monthLabel}-15`,
      title: `Вахта №1 (1–15) ${monthLabel}`,
      filename: `${monthLabel}_вахта1_зарплатный_табель.xlsx`,
    };
  }

  const lastDay = lastDayOfMonth(yearNum, monthNum);
  return {
    shift,
    year: yearNum,
    month: monthNum,
    monthLabel,
    dateFrom: `${monthLabel}-16`,
    dateTo: `${monthLabel}-${pad2(lastDay)}`,
    title: `Вахта №2 (16–${pad2(lastDay)}) ${monthLabel}`,
    filename: `${monthLabel}_вахта2_зарплатный_табель.xlsx`,
  };
}

/** Вахты, которые нужно выгрузить в календарный день (15-е и 30-е / последний день месяца). */
function shiftsDueOnCalendarDay(refDate = new Date()) {
  const year = refDate.getFullYear();
  const month = refDate.getMonth() + 1;
  const day = refDate.getDate();
  const lastDay = lastDayOfMonth(year, month);
  const due = [];

  if (day === 15) {
    const shift1 = shiftPeriodBounds(year, month, 1);
    if (shift1) due.push(shift1);
  }

  const isSecondSyncDay = day === 30 || (day === lastDay && lastDay < 30);
  if (isSecondSyncDay) {
    const shift2 = shiftPeriodBounds(year, month, 2);
    if (shift2) due.push(shift2);
  }

  return due;
}

/** Для ручной синхронизации: текущий и прошлый месяц, обе вахты. */
function listSalaryShiftsForArchiveSync(refDate = new Date()) {
  const keys = new Set();
  const shifts = [];

  const addMonth = (year, month) => {
    for (const shiftNum of [1, 2]) {
      const period = shiftPeriodBounds(year, month, shiftNum);
      if (!period) continue;
      const key = `${period.monthLabel}-s${shiftNum}`;
      if (keys.has(key)) continue;
      keys.add(key);
      shifts.push(period);
    }
  };

  const year = refDate.getFullYear();
  const month = refDate.getMonth() + 1;
  addMonth(year, month);

  const prev = new Date(year, refDate.getMonth() - 1, 1);
  addMonth(prev.getFullYear(), prev.getMonth() + 1);

  return shifts.sort(
    (a, b) =>
      a.monthLabel.localeCompare(b.monthLabel) || a.shift - b.shift
  );
}

function shiftFolderName(shift) {
  const from = formatRuShortDate(shift.dateFrom);
  const to = formatRuShortDate(shift.dateTo);
  return `вахта ${from}-${to}`;
}

/** Имя файла-снимка на дату выгрузки (15.07.26.xlsx) — каждая выдача = отдельный файл в истории. */
function earningsSnapshotFilename(exportDateIso) {
  return `${formatRuShortDate(exportDateIso)}.xlsx`;
}

/** @deprecated используйте shiftFolderName + earningsSnapshotFilename */
function shiftArchiveFilename(shift) {
  return `${shiftFolderName(shift)}.xlsx`;
}

function formatRuShortDate(isoDate) {
  const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '00.00.00';
  const [, year, month, day] = match;
  return `${day}.${month}.${year.slice(-2)}`;
}

function listShiftsOverlappingRange(dateFrom, dateTo) {
  const from = String(dateFrom || '').slice(0, 10);
  const to = String(dateTo || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return [];
  }

  const startYear = Number(from.slice(0, 4));
  const startMonth = Number(from.slice(5, 7));
  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(5, 7));

  const shifts = [];
  let year = startYear;
  let month = startMonth;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    for (const shiftNum of [1, 2]) {
      const shift = shiftPeriodBounds(year, month, shiftNum);
      if (!shift) continue;
      if (shift.dateTo < from || shift.dateFrom > to) continue;
      shifts.push({
        ...shift,
        effectiveFrom: from > shift.dateFrom ? from : shift.dateFrom,
        effectiveTo: to < shift.dateTo ? to : shift.dateTo,
      });
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return shifts;
}

module.exports = {
  shiftPeriodBounds,
  shiftsDueOnCalendarDay,
  listSalaryShiftsForArchiveSync,
  listShiftsOverlappingRange,
  shiftFolderName,
  earningsSnapshotFilename,
  shiftArchiveFilename,
  formatRuShortDate,
};
