import { api } from './client';
import type { EarningsSummary } from '../types';

export async function getEarningsSummary(params?: {
  from?: string;
  to?: string;
  driver_id?: number;
}): Promise<EarningsSummary> {
  const { data } = await api.get<EarningsSummary>('/earnings/summary', { params });
  return data;
}
