import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { getSalaryAccrued, getSalarySummary } from '../api/salary';
import { apiErrorMessage } from '../api/client';
import {
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_TYPE_OPTIONS,
} from '../constants/salary';
import {
  buildSalaryPaymentPayload,
  defaultSalaryPaymentValues,
  salaryPaymentSchema,
  type SalaryPaymentFormValues,
} from '../schemas/salaryPaymentSchema';
import type { Driver } from '../types';

interface SalaryPaymentFormProps {
  drivers: Driver[];
  initialDriverId?: number;
  initialPeriod?: { from: string; to: string };
  submitting?: boolean;
  onSubmit: (payload: ReturnType<typeof buildSalaryPaymentPayload>) => void | Promise<void>;
  onCancel: () => void;
}

export function SalaryPaymentForm({
  drivers,
  initialDriverId,
  initialPeriod,
  submitting = false,
  onSubmit,
  onCancel,
}: SalaryPaymentFormProps) {
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<SalaryPaymentFormValues>({
    resolver: zodResolver(salaryPaymentSchema),
    defaultValues: defaultSalaryPaymentValues(initialDriverId, initialPeriod),
  });

  const driverId = useWatch({ control, name: 'driver_id' });
  const periodStart = useWatch({ control, name: 'period_start' });
  const periodEnd = useWatch({ control, name: 'period_end' });
  const paymentType = useWatch({ control, name: 'type' });

  const [previewNet, setPreviewNet] = useState<number | null>(null);
  const [maxDebt, setMaxDebt] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!Number.isFinite(driverId) || driverId <= 0 || !periodStart || !periodEnd) {
      setPreviewNet(null);
      setMaxDebt(null);
      return;
    }
    if (periodStart > periodEnd) {
      setPreviewNet(null);
      setMaxDebt(null);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);

    Promise.all([
      getSalaryAccrued(driverId, periodStart, periodEnd),
      getSalarySummary(driverId, { from: periodStart, to: periodEnd }),
    ])
      .then(([accrued, summary]) => {
        if (cancelled) return;
        setPreviewNet(accrued.net);
        setMaxDebt(Math.max(0, summary.debt));
        setValue('maxDebt', Math.max(0, summary.debt));
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviewNet(null);
        setMaxDebt(null);
        toast.error(apiErrorMessage(err, 'Не удалось рассчитать начисления'));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [driverId, periodEnd, periodStart, setValue]);

  return (
    <form
      className="form-stack"
      onSubmit={handleSubmit(async (values) => {
        await onSubmit(buildSalaryPaymentPayload(values));
      })}
    >
      <label className="field">
        <span>Водитель *</span>
        <select
          {...register('driver_id', {
            setValueAs: (value) => {
              if (value === '' || value == null) return Number.NaN;
              return Number(value);
            },
          })}
        >
          <option value="">Выберите водителя</option>
          {drivers.map((driver) => (
            <option key={driver.id} value={driver.id}>
              {driver.full_name ?? driver.email}
              {driver.car_number ? ` · ${driver.car_number}` : ''}
            </option>
          ))}
        </select>
        {errors.driver_id?.message ? <span className="field-error">{errors.driver_id.message}</span> : null}
      </label>

      <div className="toolbar inline-toolbar">
        <label className="field grow-field">
          <span>Начало периода *</span>
          <input type="date" {...register('period_start')} />
          {errors.period_start?.message ? (
            <span className="field-error">{errors.period_start.message}</span>
          ) : null}
        </label>
        <label className="field grow-field">
          <span>Конец периода *</span>
          <input type="date" {...register('period_end')} />
          {errors.period_end?.message ? (
            <span className="field-error">{errors.period_end.message}</span>
          ) : null}
        </label>
      </div>

      {previewLoading ? <p className="muted small">Расчёт начислений…</p> : null}
      {previewNet != null ? (
        <p className="info-line">
          Начислено по рейсам за период: <strong>{previewNet.toFixed(0)} ₽</strong>
        </p>
      ) : null}
      {maxDebt != null && paymentType !== 'deduction' ? (
        <p className="muted small">Текущий долг за период: {maxDebt.toFixed(0)} ₽</p>
      ) : null}

      <label className="field">
        <span>Тип операции *</span>
        <select {...register('type')}>
          {PAYMENT_TYPE_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      {paymentType !== 'deduction' ? (
        <label className="field">
          <span>Способ выплаты *</span>
          <select {...register('method')}>
            {PAYMENT_METHOD_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          {errors.method?.message ? <span className="field-error">{errors.method.message}</span> : null}
        </label>
      ) : null}

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
        <span>Комментарий</span>
        <input type="text" {...register('note')} placeholder="Необязательно" />
      </label>

      <div className="action-row">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
          Отмена
        </button>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </form>
  );
}

interface SalaryPaymentModalProps {
  open: boolean;
  drivers: Driver[];
  initialDriverId?: number;
  initialPeriod?: { from: string; to: string };
  submitting?: boolean;
  title?: string;
  onSubmit: (payload: ReturnType<typeof buildSalaryPaymentPayload>) => void | Promise<void>;
  onClose: () => void;
}

export function SalaryPaymentModal({
  open,
  drivers,
  initialDriverId,
  initialPeriod,
  submitting = false,
  title = 'Новая выплата',
  onSubmit,
  onClose,
}: SalaryPaymentModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card modal-card-wide card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="salary-payment-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="salary-payment-modal-title">{title}</h3>
        <p className="muted small">
          Начисления по рейсам считаются автоматически. Здесь фиксируется выплата или удержание.
        </p>
        <SalaryPaymentForm
          key={`${initialDriverId ?? 'none'}-${initialPeriod?.from ?? ''}-${initialPeriod?.to ?? ''}`}
          drivers={drivers}
          initialDriverId={initialDriverId}
          initialPeriod={initialPeriod}
          submitting={submitting}
          onSubmit={onSubmit}
          onCancel={onClose}
        />
      </div>
    </div>
  );
}
