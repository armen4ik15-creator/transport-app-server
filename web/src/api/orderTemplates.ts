import { api } from './client';
import type { OrderTemplate } from '../types';

export async function listOrderTemplates(): Promise<OrderTemplate[]> {
  const { data } = await api.get<OrderTemplate[]>('/order-templates');
  return data;
}

export async function createOrderTemplate(payload: {
  name: string;
  contractor_id?: number | null;
  material?: string;
  unit?: string;
  default_quantity?: number | null;
  driver_rate?: number | null;
  company_rate?: number | null;
  distance_km?: number | null;
  notes?: string;
  description?: string;
  load_address?: string;
  unload_address?: string;
}): Promise<OrderTemplate> {
  const { data } = await api.post<OrderTemplate>('/order-templates', payload);
  return data;
}

export async function deleteOrderTemplate(id: number): Promise<void> {
  await api.delete(`/order-templates/${id}`);
}

export async function createOrderTemplateFromOrder(orderId: number, name: string): Promise<OrderTemplate> {
  const { data } = await api.post<OrderTemplate>('/order-templates/from-order', {
    order_id: orderId,
    name,
  });
  return data;
}
