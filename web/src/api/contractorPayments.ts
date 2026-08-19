import { api } from './client';
import type { ContractorPayment } from '../types';

export async function listContractorPayments(contractorId?: number): Promise<ContractorPayment[]> {
  const { data } = await api.get<ContractorPayment[]>('/contractors/payments', {
    params: contractorId ? { contractor_id: contractorId } : undefined,
  });
  return data;
}

export async function createContractorPayment(payload: {
  contractor_id: number;
  amount: number;
  note?: string;
  payment_date?: string;
}): Promise<ContractorPayment> {
  const { data } = await api.post<ContractorPayment>('/contractors/payments', payload);
  return data;
}

export async function deleteContractorPayment(id: number): Promise<void> {
  await api.delete(`/contractors/payments/${id}`);
}
