import type { Driver, DriverListStats } from '../types';

export type DriverStatusFilter = 'all' | 'active' | 'inactive';

export function filterDrivers(
  drivers: Driver[],
  query: string,
  status: DriverStatusFilter
): Driver[] {
  const normalizedQuery = query.trim().toLowerCase();

  return drivers.filter((driver) => {
    if (status === 'active' && !driver.is_active) return false;
    if (status === 'inactive' && driver.is_active) return false;

    if (!normalizedQuery) return true;

    const haystack = [
      driver.full_name,
      driver.phone,
      driver.email,
      driver.car_number,
      driver.license_number,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

export function driverStatusLabel(isActive: number): string {
  return isActive ? 'Активен' : 'Неактивен';
}

export function mergeDriverStats(
  driverId: number,
  statsMap: Record<number, DriverListStats>
): DriverListStats {
  return statsMap[driverId] ?? { totalTrips: 0, totalEarnings: 0 };
}
