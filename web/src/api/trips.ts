import { api } from './client';
import type { TripRecord } from '../types';

export async function listTrips(params?: {
  order_id?: number;
  driver_id?: number;
  from?: string;
  to?: string;
}): Promise<TripRecord[]> {
  const { data } = await api.get<TripRecord[]>('/trips', { params });
  return data;
}
