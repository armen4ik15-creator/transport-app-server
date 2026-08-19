import { z } from 'zod';
import { isFutureDate, todayIso } from '../utils/datePeriods';
import type { ExpenseRecord } from '../types';

export const expenseFormSchema = z.object({
  exp_date: z
    .string()
    .trim()
    .min(1, 'Укажите дату')
    .refine((value) => !isFutureDate(value), 'Дата не может быть в будущем'),
  exp_type: z.string().trim().min(1, 'Выберите категорию'),
  method: z.enum(['cash', 'noncash', 'none']),
  amount: z
    .number({ message: 'Укажите сумму' })
    .refine((value) => Number.isFinite(value), 'Укажите сумму')
    .positive('Сумма должна быть больше 0')
    .refine((value) => Math.round(value * 100) === value * 100, 'Не более 2 знаков после запятой'),
  comment: z.string().trim().optional(),
});

export type ExpenseFormValues = z.infer<typeof expenseFormSchema>;

export const defaultExpenseFormValues: Omit<ExpenseFormValues, 'amount'> & { amount?: number } = {
  exp_date: todayIso(),
  exp_type: 'other',
  method: 'noncash',
  comment: '',
};

export function expenseToFormValues(record: ExpenseRecord): ExpenseFormValues {
  return {
    exp_date: record.exp_date,
    exp_type: record.exp_type,
    method: record.method === 'cash' || record.method === 'noncash' ? record.method : 'none',
    amount: record.amount,
    comment: record.comment ?? '',
  };
}

export function buildExpensePayload(values: ExpenseFormValues) {
  return {
    exp_date: values.exp_date,
    exp_type: values.exp_type,
    method: values.method,
    amount: values.amount,
    comment: values.comment?.trim() || undefined,
  };
}
