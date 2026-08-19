import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { listDrivers } from '../api/drivers';
import { createSalaryPayment, getSalarySummary, listSalaryPayments } from '../api/salary';
import { apiErrorMessage } from '../api/client';
import { DataTable } from '../components/DataTable';
import { SalaryPaymentModal } from '../components/SalaryPaymentForm';
import { getPaymentMethodLabel, getPaymentTypeLabel } from '../constants/salary';
import { getReportPeriodBounds } from '../utils/datePeriods';
import { formatMoney } from '../utils/pagination';
import type { Driver, DriverPaymentRecord, DriverSalarySummary } from '../types';

interface DriverSalarySectionProps {
  driverId: number;
}

export function DriverSalarySection({ driverId }: DriverSalarySectionProps) {
  const defaultPeriod = getReportPeriodBounds('month');
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [summary, setSummary] = useState<DriverSalarySummary | null>(null);
  const [allTimeSummary, setAllTimeSummary] = useState<DriverSalarySummary | null>(null);
  const [payments, setPayments] = useState<DriverPaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [driverList, monthSummary, lifetimeSummary, paymentList] = await Promise.all([
      listDrivers(),
      getSalarySummary(driverId, { from: defaultPeriod.from, to: defaultPeriod.to }),
      getSalarySummary(driverId),
      listSalaryPayments(driverId),
    ]);
    setDrivers(driverList);
    setSummary(monthSummary);
    setAllTimeSummary(lifetimeSummary);
    setPayments(paymentList.slice(0, 10));
  }, [defaultPeriod.from, defaultPeriod.to, driverId]);

  useEffect(() => {
    load()
      .catch((err) => setError(apiErrorMessage(err, 'Не удалось загрузить зарплату')))
      .finally(() => setLoading(false));
  }, [load]);

  const onCreatePayment = async (payload: Parameters<typeof createSalaryPayment>[0]) => {
    setSaving(true);
    try {
      await createSalaryPayment(payload);
      await load();
      setPaymentOpen(false);
      toast.success('Выплата сохранена');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Не удалось сохранить выплату'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="muted">Загрузка зарплаты…</p>;

  if (error && !summary) {
    return (
      <section className="card form-section">
        <p className="error">{error}</p>
        <button type="button" className="btn-secondary" onClick={() => load()}>
          Повторить
        </button>
      </section>
    );
  }

  return (
    <section className="card form-section">
      <div className="page-header compact-header">
        <div>
          <h3>Зарплата</h3>
          <p className="muted small">
            Период: {defaultPeriod.from} — {defaultPeriod.to}
          </p>
        </div>
        <div className="action-row">
          <button type="button" className="btn-primary small-btn" onClick={() => setPaymentOpen(true)}>
            Выплатить
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="stats-grid compact-stats">
        <article className="card stat-card">
          <p className="muted small">Начислено (месяц)</p>
          <strong>{formatMoney(summary?.gross ?? 0)}</strong>
        </article>
        <article className="card stat-card">
          <p className="muted small">Выплачено (месяц)</p>
          <strong>{formatMoney(summary?.paid ?? 0)}</strong>
        </article>
        <article className="card stat-card">
          <p className="muted small">Долг (всего)</p>
          <strong>{formatMoney(allTimeSummary?.debt ?? 0)}</strong>
        </article>
      </div>

      <h4>Последние выплаты</h4>
      <DataTable
        rows={payments}
        rowKey={(row) => row.id}
        emptyMessage="Выплат пока нет"
        columns={[
          {
            key: 'date',
            header: 'Дата',
            render: (row) => new Date(row.created_at).toLocaleDateString('ru-RU'),
          },
          {
            key: 'amount',
            header: 'Сумма',
            render: (row) => formatMoney(row.amount),
          },
          {
            key: 'type',
            header: 'Тип',
            render: (row) => getPaymentTypeLabel(row.type),
          },
          {
            key: 'method',
            header: 'Метод',
            render: (row) => getPaymentMethodLabel(row.method),
          },
          {
            key: 'period',
            header: 'Период',
            render: (row) => `${row.period_start} — ${row.period_end}`,
          },
        ]}
      />

      <SalaryPaymentModal
        open={paymentOpen}
        drivers={drivers}
        initialDriverId={driverId}
        initialPeriod={defaultPeriod}
        submitting={saving}
        onSubmit={onCreatePayment}
        onClose={() => setPaymentOpen(false)}
      />
    </section>
  );
}
