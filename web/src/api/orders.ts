import { api } from './client';
import type { Order, OrderBulkPayload, OrderPhoto, OrderStatus, OrderWithPhotos, OrderWritePayload } from '../types';

export async function listOrders(): Promise<Order[]> {
  const { data } = await api.get<Order[]>('/orders');
  return data;
}

export async function getOrder(id: number): Promise<OrderWithPhotos> {
  const { data } = await api.get<OrderWithPhotos>(`/orders/${id}`);
  return data;
}

export async function createOrder(payload: OrderWritePayload & { driver_id: number; contractor_id: number }): Promise<Order> {
  const { data } = await api.post<Order>('/orders', payload);
  return data;
}

export async function createOrdersBulk(payload: OrderBulkPayload & { contractor_id: number }): Promise<Order[]> {
  const { data } = await api.post<Order[]>('/orders/bulk', payload);
  return data;
}

export async function updateOrder(id: number, payload: OrderWritePayload): Promise<Order> {
  const { data } = await api.put<Order>(`/orders/${id}`, payload);
  return data;
}

export async function updateOrderStatus(id: number, status: OrderStatus): Promise<Order> {
  const { data } = await api.put<Order>(`/orders/${id}/status`, { status });
  return data;
}

export async function uploadOrderPhoto(id: number, file: File): Promise<OrderPhoto> {
  const formData = new FormData();
  formData.append('photo', file);
  const { data } = await api.post<OrderPhoto>(`/orders/${id}/photos`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30000,
  });
  return data;
}
