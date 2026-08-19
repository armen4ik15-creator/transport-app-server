import { z } from 'zod';
import { isFutureDate, todayIso } from '../utils/datePeriods';

export const cashOutflowSchema = z.object({
  exp_date: z
    .string()
    .trim()
    .min(1, 'Укажите дату')
    .refine((value) => !isFutureDate(value), 'Дата не может быть в будущем'),
  method: z.enum(['cash', 'noncash']),
  exp_type: z.string().trim().min(1, 'Выберите категорию'),
  amount: z
    .number({ message: 'Укажите сумму' })
    .refine((value) => Number.isFinite(value), 'Укажите сумму')
    .positive('Сумма должна быть больше 0'),
  comment: z.string().trim().optional(),
});

export const cashInflowSchema = z.object({
  contractor_id: z.number().int().positive('Выберите контрагента'),
  payment_date: z
    .string()
    .trim()
    .min(1, 'Укажите дату')
    .refine((value) => !isFutureDate(value), 'Дата не может быть в будущем'),
  amount: z
    .number({ message: 'Укажите сумму' })
    .refine((value) => Number.isFinite(value), 'Укажите сумму')
    .positive('Сумма должна быть больше 0'),
  note: z.string().trim().optional(),
});

export type CashOutflowFormValues = z.infer<typeof cashOutflowSchema>;
export type CashInflowFormValues = z.infer<typeof cashInflowSchema>;

export const defaultCashOutflowValues: CashOutflowFormValues = {
  exp_date: todayIso(),
  method: 'noncash',
  exp_type: 'other',
  amount: Number.NaN,
  comment: '',
};

export const defaultCashInflowValues: CashInflowFormValues = {
  contractor_id: 0,
  payment_date: todayIso(),
  amount: Number.NaN,
  note: '',
};
