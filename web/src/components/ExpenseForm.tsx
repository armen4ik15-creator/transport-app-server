import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ALL_EXPENSE_TYPES, EXPENSE_METHOD_OPTIONS } from '../constants/expenseTypes';
import {
  buildExpensePayload,
  defaultExpenseFormValues,
  expenseFormSchema,
  expenseToFormValues,
  type ExpenseFormValues,
} from '../schemas/expenseSchema';
import type { ExpenseRecord } from '../types';

interface ExpenseFormProps {
  initial?: ExpenseRecord;
  submitting?: boolean;
  onSubmit: (payload: ReturnType<typeof buildExpensePayload>) => void | Promise<void>;
  onCancel: () => void;
}

export function ExpenseForm({ initial, submitting = false, onSubmit, onCancel }: ExpenseFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: initial
      ? expenseToFormValues(initial)
      : { ...defaultExpenseFormValues, amount: Number.NaN },
  });

  return (
    <form
      className="form-stack"
      onSubmit={handleSubmit(async (values) => {
        await onSubmit(buildExpensePayload(values));
      })}
    >
      <section className="card form-section">
        <label className="field">
          <span>Дата *</span>
          <input type="date" {...register('exp_date')} />
          {errors.exp_date?.message ? <span className="field-error">{errors.exp_date.message}</span> : null}
        </label>

        <label className="field">
          <span>Категория *</span>
          <select {...register('exp_type')}>
            {ALL_EXPENSE_TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          {errors.exp_type?.message ? <span className="field-error">{errors.exp_type.message}</span> : null}
        </label>

        <label className="field">
          <span>Способ оплаты *</span>
          <select {...register('method')}>
            {EXPENSE_METHOD_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Сумма, ₽ *</span>
          <input
            type="number"
            min={0}
            step="0.01"
            {...register('amount', {
              setValueAs: (value) => {
                if (value === '' || value == null) return Number.NaN;
                return Number(value);
              },
            })}
          />
          {errors.amount?.message ? <span className="field-error">{errors.amount.message}</span> : null}
        </label>

        <label className="field">
          <span>Описание</span>
          <textarea rows={3} {...register('comment')} />
        </label>
      </section>

      <div className="action-row">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Сохранение…' : initial ? 'Сохранить изменения' : 'Добавить расход'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
          Отмена
        </button>
      </div>
    </form>
  );
}
