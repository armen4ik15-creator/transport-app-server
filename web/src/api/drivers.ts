import { api } from './client';
import type { Driver } from '../types';

export async function listDrivers(): Promise<Driver[]> {
  const { data } = await api.get<Driver[]>('/drivers');
  return data;
}
