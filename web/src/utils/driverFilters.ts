import type { Driver } from '../types';

export type DriverStatusFilter = 'all' | 'active' | 'inactive';
export type DriverArchiveFilter = 'hide' | 'only' | 'all';

export function filterDrivers(
  drivers: Driver[],
  query: string,
  status: DriverStatusFilter,
  archive: DriverArchiveFilter = 'hide'
): Driver[] {
  const normalizedQuery = query.trim().toLowerCase();

  return drivers.filter((driver) => {
    const archived = Boolean(driver.is_archived);
    if (archive === 'hide' && archived) return false;
    if (archive === 'only' && !archived) return false;

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

export function driverStatusLabel(isActive: number, isArchived?: number): string {
  if (isArchived) return 'Архив';
  return isActive ? 'Активен' : 'Неактивен';
}
