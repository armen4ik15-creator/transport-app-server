import { api } from './client';
import type { Contractor } from '../types';

export async function listContractors(): Promise<Contractor[]> {
  const { data } = await api.get<Contractor[]>('/contractors');
  return data;
}
