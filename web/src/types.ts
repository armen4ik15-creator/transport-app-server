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
  phone: string | null;
  car_number: string | null;
  license_number: string | null;
  license_expiry: string | null;
  medical_check_expiry: string | null;
  is_active: number;
  senior_shift_bonus?: number;
  created_at: string;
}

export interface DriverBalance {
  driver_id: number;
  income: number;
  expense: number;
  balance: number;
}

export interface EarningsTripItem {
  id: number;
  order_id: number;
  driver_id: number;
  ttn_number: string | null;
  volume: number | null;
  created_at: string;
  completed_at: string | null;
  driver_rate: number;
  photo_path: string | null;
  has_photos?: boolean;
  counted_in_salary?: boolean;
}

export interface EarningsSummary {
  total_trips: number;
  eligible_trips?: number;
  total_volume: number;
  estimated_income: number;
  actual_income: number;
  actual_expense: number;
  actual_balance: number;
  total_earnings?: number;
  trips?: EarningsTripItem[];
}

export interface DriverListStats {
  totalTrips: number;
  totalEarnings: number;
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

export type ExpenseMethod = 'cash' | 'noncash' | 'none' | null;
export type ExpenseStatus = 'pending' | 'approved' | 'rejected';
export type ExpenseSource = 'driver' | 'admin' | 'system';

export interface ExpenseRecord {
  id: number;
  exp_date: string;
  exp_type: string;
  method: ExpenseMethod;
  amount: number;
  comment: string | null;
  driver_id: number | null;
  car_number: string | null;
  created_by: number | null;
  created_at: string;
  driver_name: string | null;
  status?: ExpenseStatus | null;
  source?: ExpenseSource | null;
  rejection_reason?: string | null;
  photo_path?: string | null;
  updated_at?: string | null;
}

export interface CompanyCashSummary {
  opening_cash_balance: number;
  opening_cash_date: string | null;
  payments_in: number;
  expenses_out: number;
  bank_settlement_out?: number;
  cash_desk_out?: number;
  off_settlement_expenses?: number;
  driver_payments_out: number;
  estimated_cash_balance: number;
  other_inflows?: number;
  fuel_fills?: number;
  fuel_card_topups?: number;
  estimated_fuel_card_balance?: number;
}

export interface CompanyCashSettings {
  opening_cash_balance: number;
  opening_cash_date: string | null;
  opening_fuel_card_balance: number;
  opening_fuel_card_date: string | null;
  updated_at: string | null;
}

export interface ContractorPayment {
  id: number;
  contractor_id: number;
  amount: number;
  note: string | null;
  payment_date: string | null;
  created_by: number | null;
  created_at: string;
  contractor_name: string;
}

export interface ReportDailyDay {
  date: string;
  trips_count: number;
  revenue: number;
  driver_pay: number;
  expenses: number;
  expenses_count: number;
  costs: number;
  profit: number;
}

export interface ReportDailyResponse {
  days: ReportDailyDay[];
  totals: {
    trips_count: number;
    revenue: number;
    driver_pay: number;
    expenses: number;
    costs: number;
    profit: number;
  };
}

export interface ReportSummary {
  orders_total: number;
  orders_completed: number;
  documents_total: number;
  expenses_total: number;
  expenses_amount: number;
  income: number;
  expense: number;
  balance: number;
  trips_count?: number;
  revenue?: number;
  driver_pay?: number;
  profit?: number;
}

export type DriverPaymentType = 'salary' | 'advance' | 'bonus' | 'deduction';
export type DriverPaymentMethod = 'cash' | 'noncash';

export interface DriverPaymentRecord {
  id: number;
  driver_id: number;
  type: DriverPaymentType;
  amount: number;
  method: DriverPaymentMethod | null;
  note: string | null;
  period_start: string;
  period_end: string;
  created_by: number | null;
  created_at: string;
  driver_name?: string | null;
  driver_car_number?: string | null;
}

export interface DriverSalarySummary {
  driver_id: number;
  from: string;
  to: string;
  gross: number;
  gross_trips: number;
  senior_allowance: number;
  compensations: number;
  paid: number;
  deducted: number;
  debt: number;
}

export interface DriverDebtSummary {
  driver_id: number;
  driver_name: string | null;
  driver_car_number?: string | null;
  gross: number;
  gross_trips: number;
  senior_allowance: number;
  compensations: number;
  paid: number;
  deducted: number;
  debt: number;
}

export interface DriverAccruedPreview {
  driver_id: number;
  from: string;
  to: string;
  accrued: number;
  senior_allowance: number;
  compensations: number;
  deductions: number;
  net: number;
}
