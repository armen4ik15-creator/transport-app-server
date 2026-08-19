export type Role = 'admin' | 'driver';

export interface User {
  id: number;
  email: string;
  role: Role;
  full_name?: string | null;
  phone?: string | null;
}

export interface Driver {
  id: number;
  user_id: number;
  email: string;
  full_name: string | null;
  car_number: string | null;
  is_active: number;
}

export interface Contractor {
  id: number;
  name: string;
  type: string;
  phone: string | null;
  address: string | null;
  opening_balance?: number;
  opening_balance_date?: string | null;
  created_by: number | null;
  created_at: string;
}

export interface Material {
  id: number;
  name: string;
  unit: string;
  price_per_ton: number | null;
  created_by: number | null;
  created_at: string;
}

export type OrderStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface Order {
  id: number;
  driver_id: number | null;
  contractor_id: number | null;
  task_name: string | null;
  sender: string | null;
  receiver: string | null;
  total_planned_volume: number | null;
  material: string | null;
  quantity: number | null;
  unit: string | null;
  status: OrderStatus;
  notes: string | null;
  created_by: number | null;
  description: string | null;
  load_address: string | null;
  unload_address: string | null;
  amount: number | null;
  driver_rate: number | null;
  company_rate: number | null;
  distance_km: number | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  contractor_name: string | null;
  driver_name: string | null;
  driver_car_number: string | null;
}

export interface OrderPhoto {
  id: number;
  order_id: number;
  file_path: string;
  uploaded_at: string;
}

export type TripStage = 'loading' | 'unloading';

export interface TripRecord {
  id: number;
  order_id: number;
  driver_id: number;
  driver_name?: string | null;
  driver_car_number?: string | null;
  stage: TripStage;
  status?: string | null;
  ttn_number: string | null;
  volume: number | null;
  note: string | null;
  photo_path: string | null;
  photo_available?: boolean;
  created_at: string;
  completed_at?: string | null;
  material?: string | null;
  load_address?: string | null;
  unload_address?: string | null;
  contractor_name?: string | null;
}

export interface OrderWithPhotos extends Order {
  photos: OrderPhoto[];
  trips: TripRecord[];
}

export interface OrderTemplate {
  id: number;
  name: string;
  contractor_id: number | null;
  contractor_name: string | null;
  material: string | null;
  unit: string | null;
  default_quantity: number | null;
  driver_rate: number | null;
  company_rate: number | null;
  distance_km: number | null;
  notes: string | null;
  description: string | null;
  load_address: string | null;
  unload_address: string | null;
  created_by: number | null;
  created_at: string;
}

export interface OrderWritePayload {
  driver_id?: number;
  contractor_id?: number;
  task_name?: string;
  sender?: string;
  receiver?: string;
  total_planned_volume?: number | null;
  material?: string;
  quantity?: number | null;
  unit?: string;
  notes?: string;
  driver_rate?: number | null;
  company_rate?: number | null;
  distance_km?: number | null;
  is_active?: boolean;
  description?: string;
  load_address?: string;
  unload_address?: string;
  amount?: number | null;
}

export interface OrderBulkPayload extends Omit<OrderWritePayload, 'driver_id'> {
  driver_ids: number[];
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Новый',
  in_progress: 'В пути',
  completed: 'Завершён',
  cancelled: 'Отменён',
};

export const TRIP_STAGE_LABEL: Record<TripStage, string> = {
  loading: 'Погрузка',
  unloading: 'Разгрузка',
};
