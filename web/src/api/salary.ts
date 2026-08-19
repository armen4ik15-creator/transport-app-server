import { api } from './client';
import type {
  DriverAccruedPreview,
  DriverDebtSummary,
  DriverPaymentRecord,
  DriverPaymentMethod,
  DriverPaymentType,
  DriverSalarySummary,
} from '../types';

export interface SalaryPaymentPayload {
  driver_id: number;
  type: DriverPaymentType;
  amount: number;
  period_start: string;
  period_end: string;
  method?: DriverPaymentMethod | null;
  note?: string;
}

export async function listSalaryPayments(driverId?: number): Promise<DriverPaymentRecord[]> {
  const { data } = await api.get<DriverPaymentRecord[]>('/salary/payments', {
    params: driverId ? { driver_id: driverId } : undefined,
  });
  return data;
}

export async function createSalaryPayment(payload: SalaryPaymentPayload): Promise<DriverPaymentRecord> {
  const { data } = await api.post<DriverPaymentRecord>('/salary/payments', payload);
  return data;
}

export async function deleteSalaryPayment(id: number): Promise<void> {
  await api.delete(`/salary/payments/${id}`);
}

export async function getSalarySummary(
  driverId: number,
  params?: { from?: string; to?: string }
): Promise<DriverSalarySummary> {
  const { data } = await api.get<DriverSalarySummary>('/salary/summary', {
    params: { driver_id: driverId, ...params },
  });
  return data;
}

export async function getSalaryDebts(): Promise<DriverDebtSummary[]> {
  const { data } = await api.get<DriverDebtSummary[]>('/salary/debts');
  return data;
}

export async function getSalaryAccrued(
  driverId: number,
  from: string,
  to: string
): Promise<DriverAccruedPreview> {
  const { data } = await api.get<DriverAccruedPreview>('/salary/accrued', {
    params: { driver_id: driverId, from, to },
  });
  return data;
}
