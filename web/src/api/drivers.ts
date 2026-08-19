import { api } from './client';
import type { Driver } from '../types';

export interface DriverCreatePayload {
  email: string;
  password: string;
  full_name: string;
  phone?: string;
  car_number?: string;
  license_number?: string;
  license_expiry?: string;
  medical_check_expiry?: string;
  is_active?: boolean;
  senior_shift_bonus?: number;
}

export interface DriverUpdatePayload {
  email?: string;
  password?: string;
  full_name?: string;
  phone?: string | null;
  car_number?: string | null;
  license_number?: string | null;
  license_expiry?: string | null;
  medical_check_expiry?: string | null;
  is_active?: boolean;
  senior_shift_bonus?: number | null;
}

export async function listDrivers(): Promise<Driver[]> {
  const { data } = await api.get<Driver[]>('/drivers');
  return data;
}

export async function getDriverById(id: number): Promise<Driver | null> {
  const drivers = await listDrivers();
  return drivers.find((driver) => driver.id === id) ?? null;
}

export async function createDriver(payload: DriverCreatePayload): Promise<Driver> {
  const { data } = await api.post<Driver>('/drivers', payload);
  return data;
}

export async function updateDriver(id: number, payload: DriverUpdatePayload): Promise<Driver> {
  const { data } = await api.put<Driver>(`/drivers/${id}`, payload);
  return data;
}

export async function deleteDriver(id: number): Promise<void> {
  await api.delete(`/drivers/${id}`);
}
