import { api } from './client';
import type { ExpenseMethod, ExpenseRecord } from '../types';

export async function listExpenses(params?: {
  from?: string;
  to?: string;
  driver_id?: number;
  status?: string;
}): Promise<ExpenseRecord[]> {
  const { data } = await api.get<ExpenseRecord[]>('/expenses', { params });
  return data;
}

export async function getExpenseById(id: number): Promise<ExpenseRecord | null> {
  const rows = await listExpenses();
  return rows.find((row) => row.id === id) ?? null;
}

export async function createExpense(payload: {
  exp_date?: string;
  exp_type?: string;
  method?: ExpenseMethod;
  amount: number;
  comment?: string;
  driver_id?: number;
  car_number?: string;
}): Promise<ExpenseRecord> {
  const body =
    payload.method === 'none'
      ? { ...payload, method: 'none', off_settlement: true }
      : payload;
  const { data } = await api.post<ExpenseRecord>('/expenses', body);
  return data;
}

export async function approveExpense(id: number): Promise<ExpenseRecord> {
  const { data } = await api.patch<ExpenseRecord>(`/expenses/${id}/review`, { action: 'approve' });
  return data;
}

export async function rejectExpense(id: number, rejectionReason: string): Promise<ExpenseRecord> {
  const { data } = await api.patch<ExpenseRecord>(`/expenses/${id}/review`, {
    action: 'reject',
    rejection_reason: rejectionReason,
  });
  return data;
}

export async function deleteExpense(id: number): Promise<void> {
  await api.delete(`/expenses/${id}`);
}
