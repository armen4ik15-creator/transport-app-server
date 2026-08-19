import { api } from './client';
import type { ReportDailyResponse, ReportSummary } from '../types';

export async function getReportDaily(params: {
  from: string;
  to: string;
  driver_id?: number;
}): Promise<ReportDailyResponse> {
  const { data } = await api.get<ReportDailyResponse>('/reports/daily', { params });
  return data;
}

export async function getReportSummary(params?: {
  from?: string;
  to?: string;
  driver_id?: number;
}): Promise<ReportSummary> {
  const { data } = await api.get<ReportSummary>('/reports/summary', { params });
  return data;
}
