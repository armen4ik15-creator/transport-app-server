import { api } from './client';
import type { Driver, User } from '../types';

export interface AuthResponse {
  token: string;
  user: User;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>('/auth/login', { email, password });
  return data;
}

export async function getMe(): Promise<{ user: User; driver: Driver | null }> {
  const { data } = await api.get<{ user: User; driver: Driver | null }>('/auth/me');
  return data;
}
