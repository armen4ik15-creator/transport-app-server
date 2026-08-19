import { api } from './client';
import type { Material } from '../types';

export async function listMaterials(): Promise<Material[]> {
  const { data } = await api.get<Material[]>('/materials');
  return data;
}
