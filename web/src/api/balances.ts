import { api } from './client';
import type { DriverBalance } from '../types';

export async function getDriverBalance(driverId: number): Promise<DriverBalance> {
  const { data } = await api.get<DriverBalance>(`/balances/drivers/${driverId}/balance`);
  return data;
}
