const { shiftPeriodBounds } = require('./salaryShiftPeriods');
const {
  asIsoDate,
  asNumber,
  calcDriverCompensations,
  calcDriverDeductions,
  calcDriverPayouts,
  calcDriverSeniorAllowance,
  calcDriverTripAccrued,
  formatPeriodLabel,
  isTripSalaryEligible,
} = require('./salaryCalculations');

const SETTLED_EPSILON = 0.01;

/** @typedef {'no_photo' | 'paid' | 'unpaid'} TripSalaryPaymentStatus */

function shiftKey(dateFrom, dateTo) {
  return `${dateFrom}:${dateTo}`;
}

function getTripIsoDate(trip) {
  return asIsoDate(trip?.completed_at ?? trip?.created_at);
}

function findShiftForTripDate(isoDate) {
  const normalized = String(isoDate || '').slice(0, 10);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const shiftNum = day <= 15 ? 1 : 2;
  const shift = shiftPeriodBounds(year, month, shiftNum);
  if (!shift) return null;

  return {
    dateFrom: shift.dateFrom,
    dateTo: shift.dateTo,
    label: formatPeriodLabel(shift.dateFrom, shift.dateTo),
  };
}

function listManualShiftSettlements(db, driverId, dateFrom, dateTo) {
  try {
    return db
      .prepare(
        `SELECT period_start, period_end, note, created_at
         FROM salary_shift_settlements
         WHERE driver_id = ?
           AND period_start <= ?
           AND period_end >= ?`
      )
      .all(driverId, dateTo, dateFrom);
  } catch {
    return [];
  }
}

function isShiftManuallySettled(manualSettlements, shift) {
  return manualSettlements.some(
    (row) =>
      String(row.period_start).slice(0, 10) === shift.dateFrom &&
      String(row.period_end).slice(0, 10) === shift.dateTo
  );
}

function buildShiftSettlementInfo(db, driverId, shift, manualSettlements) {
  const accruedTrips = calcDriverTripAccrued(db, driverId, shift.dateFrom, shift.dateTo);
  const seniorAllowance = calcDriverSeniorAllowance(db, driverId, shift.dateFrom, shift.dateTo);
  const compensations = calcDriverCompensations(db, driverId, shift.dateFrom, shift.dateTo);
  const deductions = calcDriverDeductions(db, driverId, shift.dateFrom, shift.dateTo);
  const paid = calcDriverPayouts(db, driverId, shift.dateFrom, shift.dateTo);
  const accruedTotal = accruedTrips + seniorAllowance + compensations - deductions;
  const debt = accruedTotal - paid;
  const manuallySettled = isShiftManuallySettled(manualSettlements, shift);
  const settled =
    manuallySettled || (accruedTotal <= SETTLED_EPSILON && paid <= SETTLED_EPSILON) || paid + SETTLED_EPSILON >= accruedTotal;

  return {
    shift_from: shift.dateFrom,
    shift_to: shift.dateTo,
    shift_label: shift.label,
    accrued_total: accruedTotal,
    paid_total: paid,
    shift_debt: debt > SETTLED_EPSILON ? debt : 0,
    settled,
    manually_settled: manuallySettled,
  };
}

/**
 * Кэш статусов вахт водителя за диапазон дат.
 * @returns {Map<string, ReturnType<typeof buildShiftSettlementInfo>>}
 */
function buildDriverShiftSettlementCache(db, driverId, dateFrom, dateTo) {
  const cache = new Map();
  if (!driverId || !dateFrom || !dateTo || dateFrom > dateTo) {
    return cache;
  }

  const manualSettlements = listManualShiftSettlements(db, driverId, dateFrom, dateTo);
  const startYear = Number(dateFrom.slice(0, 4));
  const startMonth = Number(dateFrom.slice(5, 7));
  const endYear = Number(dateTo.slice(0, 4));
  const endMonth = Number(dateTo.slice(5, 7));

  let year = startYear;
  let month = startMonth;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    for (const shiftNum of [1, 2]) {
      const shift = shiftPeriodBounds(year, month, shiftNum);
      if (!shift || shift.dateTo < dateFrom || shift.dateFrom > dateTo) continue;
      const key = shiftKey(shift.dateFrom, shift.dateTo);
      if (cache.has(key)) continue;
      cache.set(
        key,
        buildShiftSettlementInfo(
          db,
          driverId,
          { dateFrom: shift.dateFrom, dateTo: shift.dateTo, label: formatPeriodLabel(shift.dateFrom, shift.dateTo) },
          manualSettlements
        )
      );
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return cache;
}

/**
 * @returns {{
 *   salary_payment_status: TripSalaryPaymentStatus,
 *   salary_shift_label: string | null,
 *   salary_shift_debt: number | null,
 *   counted_in_salary: boolean,
 * }}
 */
function resolveTripSalaryPaymentStatus(trip, shiftCache) {
  const countedInSalary = isTripSalaryEligible(trip);
  if (!countedInSalary) {
    return {
      salary_payment_status: 'no_photo',
      salary_shift_label: null,
      salary_shift_debt: null,
      counted_in_salary: false,
    };
  }

  const tripDate = getTripIsoDate(trip);
  const shift = tripDate ? findShiftForTripDate(tripDate) : null;
  if (!shift || !shiftCache) {
    return {
      salary_payment_status: 'unpaid',
      salary_shift_label: shift?.label ?? null,
      salary_shift_debt: null,
      counted_in_salary: true,
    };
  }

  const info = shiftCache.get(shiftKey(shift.dateFrom, shift.dateTo));
  if (!info) {
    return {
      salary_payment_status: 'unpaid',
      salary_shift_label: shift.label,
      salary_shift_debt: null,
      counted_in_salary: true,
    };
  }

  return {
    salary_payment_status: info.settled ? 'paid' : 'unpaid',
    salary_shift_label: info.shift_label,
    salary_shift_debt: info.settled ? 0 : asNumber(info.shift_debt),
    counted_in_salary: true,
  };
}

function enrichTripsWithSalaryPaymentStatus(db, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const byDriver = new Map();
  for (const row of rows) {
    const driverId = Number(row.driver_id);
    if (!Number.isFinite(driverId) || driverId <= 0) continue;
    if (!byDriver.has(driverId)) byDriver.set(driverId, []);
    byDriver.get(driverId).push(row);
  }

  const caches = new Map();
  for (const [driverId, driverRows] of byDriver.entries()) {
    let minDate = null;
    let maxDate = null;
    for (const row of driverRows) {
      const isoDate = getTripIsoDate(row);
      if (!isoDate) continue;
      if (!minDate || isoDate < minDate) minDate = isoDate;
      if (!maxDate || isoDate > maxDate) maxDate = isoDate;
    }
    if (minDate && maxDate) {
      caches.set(driverId, buildDriverShiftSettlementCache(db, driverId, minDate, maxDate));
    }
  }

  return rows.map((row) => {
    const cache = caches.get(Number(row.driver_id));
    const status = resolveTripSalaryPaymentStatus(row, cache);
    return {
      ...row,
      ...status,
    };
  });
}

function summarizeTripPaymentStatuses(trips) {
  let eligiblePaidTrips = 0;
  let eligibleUnpaidTrips = 0;
  let ineligibleTrips = 0;
  let paidTripEarnings = 0;
  let unpaidTripEarnings = 0;

  for (const trip of trips) {
    const rate = asNumber(trip.driver_rate);
    if (!trip.counted_in_salary) {
      ineligibleTrips += 1;
      continue;
    }
    if (trip.salary_payment_status === 'paid') {
      eligiblePaidTrips += 1;
      paidTripEarnings += rate;
    } else {
      eligibleUnpaidTrips += 1;
      unpaidTripEarnings += rate;
    }
  }

  return {
    eligible_paid_trips: eligiblePaidTrips,
    eligible_unpaid_trips: eligibleUnpaidTrips,
    ineligible_trips: ineligibleTrips,
    paid_trip_earnings: paidTripEarnings,
    unpaid_trip_earnings: unpaidTripEarnings,
  };
}

module.exports = {
  SETTLED_EPSILON,
  buildDriverShiftSettlementCache,
  enrichTripsWithSalaryPaymentStatus,
  findShiftForTripDate,
  resolveTripSalaryPaymentStatus,
  summarizeTripPaymentStatuses,
};
