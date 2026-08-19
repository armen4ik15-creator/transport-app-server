import { z } from 'zod';
import { isFutureDate } from '../utils/datePeriods';
import type { DriverPaymentType } from '../types';

export const salaryPaymentSchema = z
  .object({
    driver_id: z
      .number({ message: 'Выберите водителя' })
      .refine((value) => Number.isFinite(value) && value > 0, 'Выберите водителя'),
    period_start: z.string().trim().min(1, 'Укажите начало периода'),
    period_end: z
      .string()
      .trim()
      .min(1, 'Укажите конец периода')
      .refine((value) => !isFutureDate(value), 'Дата не может быть в будущем'),
    amount: z
      .number({ message: 'Укажите сумму' })
      .refine((value) => Number.isFinite(value), 'Укажите сумму')
      .positive('Сумма должна быть больше 0'),
    type: z.enum(['salary', 'advance', 'bonus', 'deduction']),
    method: z.enum(['cash', 'noncash']).optional(),
    note: z.string().trim().optional(),
    maxDebt: z.number().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.period_start && values.period_end && values.period_start > values.period_end) {
      ctx.addIssue({
        code: 'custom',
        message: 'Начало периода не может быть позже конца',
        path: ['period_end'],
      });
    }

    if (values.type !== 'deduction' && !values.method) {
      ctx.addIssue({
        code: 'custom',
        message: 'Выберите способ выплаты',
        path: ['method'],
      });
    }

    if (
      values.type !== 'deduction' &&
      values.maxDebt != null &&
      Number.isFinite(values.maxDebt) &&
      values.amount > values.maxDebt + 0.01
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `Сумма не может превышать долг (${values.maxDebt.toFixed(2)} ₽)`,
        path: ['amount'],
      });
    }
  });

export type SalaryPaymentFormValues = z.infer<typeof salaryPaymentSchema>;

export function defaultSalaryPaymentValues(
  driverId?: number,
  period?: { from: string; to: string }
): SalaryPaymentFormValues {
  return {
    driver_id: driverId ?? Number.NaN,
    period_start: period?.from ?? '',
    period_end: period?.to ?? '',
    amount: Number.NaN,
    type: 'salary' as DriverPaymentType,
    method: 'cash',
    note: '',
  };
}

export function buildSalaryPaymentPayload(values: SalaryPaymentFormValues) {
  return {
    driver_id: values.driver_id,
    type: values.type,
    amount: values.amount,
    period_start: values.period_start,
    period_end: values.period_end,
    method: values.type === 'deduction' ? null : values.method,
    note: values.note?.trim() || undefined,
  };
}
