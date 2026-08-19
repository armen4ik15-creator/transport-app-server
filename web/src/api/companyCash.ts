import { api } from './client';
import type { CompanyCashSettings, CompanyCashSummary } from '../types';

export async function getCompanyCashSummary(): Promise<CompanyCashSummary> {
  const { data } = await api.get<CompanyCashSummary>('/finance/cash-summary');
  return data;
}

export async function getCompanyCashSettings(): Promise<CompanyCashSettings> {
  const { data } = await api.get<CompanyCashSettings>('/finance/cash-settings');
  return data;
}

export async function updateCompanyCashSettings(payload: Partial<CompanyCashSettings>): Promise<CompanyCashSettings> {
  const { data } = await api.put<CompanyCashSettings>('/finance/cash-settings', payload);
  return data;
}
