import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { listDrivers } from '../api/drivers';
import { createSalaryPayment, deleteSalaryPayment, listSalaryPayments } from '../api/salary';
import { apiErrorMessage } from '../api/client';
import { DataTable } from '../components/DataTable';
import { SalaryPaymentModal } from '../components/SalaryPaymentForm';
import { SalarySubNav } from '../components/SalarySubNav';
import { getPaymentMethodLabel, getPaymentTypeLabel } from '../constants/salary';
import { getReportPeriodBounds, todayIso } from '../utils/datePeriods';
import { formatMoney, paginateItems, totalPages } from '../utils/pagination';
import type { Driver, DriverPaymentRecord } from '../types';

function paymentDate(record: DriverPaymentRecord): string {
  return record.created_at.slice(0, 10);
}

function inDateRange(value: string, from: string, to: string): boolean {
  return value >= from && value <= to;
}

export function SalaryPaymentsPage() {
  const defaultPeriod = getReportPeriodBounds('month');
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [records, setRecords] = useState<DriverPaymentRecord[]>([]);
  const [from, setFrom] = useState(defaultPeriod.from);
  const [to, setTo] = useState(todayIso());
  const [driverFilter, setDriverFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const driverList = drivers.length > 0 ? drivers : await listDrivers();
    if (drivers.length === 0) setDrivers(driverList);

    const driverId = driverFilter !== 'all' ? Number(driverFilter) : undefined;
    setRecords(await listSalaryPayments(driverId));
  }, [driverFilter, drivers]);

  useEffect(() => {
    load()
      .catch((err) => setError(apiErrorMessage(err, 'Не удалось загрузить выплаты')))
      .finally(() => setLoading(false));
  }, [load]);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const date = paymentDate(record);
      if (!inDateRange(date, from, to)) return false;
      if (driverFilter !== 'all' && record.driver_id !== Number(driverFilter)) return false;
      return true;
    });
  }, [driverFilter, from, records, to]);

  const pageCount = totalPages(filteredRecords.length);
  const safePage = Math.min(page, pageCount);
  const pageRows = paginateItems(filteredRecords, safePage);

  const totalPaid = useMemo(
    () =>
      filteredRecords
        .filter((record) => record.type !== 'deduction')
        .reduce((sum, record) => sum + record.amount, 0),
    [filteredRecords]
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
      toast.success('Список обновлён');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Не удалось обновить'));
    } finally {
      setRefreshing(false);
    }
  };

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

  const onDelete = async (record: DriverPaymentRecord) => {
    if (!window.confirm(`Удалить выплату ${formatMoney(record.amount)} (${record.driver_name})?`)) return;
    setBusyId(record.id);
    try {
      await deleteSalaryPayment(record.id);
      await load();
      toast.success('Выплата удалена');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Не удалось удалить'));
    } finally {
      setBusyId(null);
    }
  };

  const selectedDriverId = driverFilter !== 'all' ? Number(driverFilter) : undefined;

  if (loading) return <p className="muted">Загрузка выплат…</p>;

  if (error && records.length === 0) {
    return (
      <section className="wide-section">
        <SalarySubNav />
        <p className="error">{error}</p>
        <button type="button" className="btn-primary" onClick={() => load()}>
          Повторить
        </button>
      </section>
    );
  }

  return (
    <section className="wide-section">
      <SalarySubNav />

      <div className="page-header">
        <div>
          <h2>Выплаты ({filteredRecords.length})</h2>
          <p className="muted">История зарплат, авансов, бонусов и удержаний.</p>
        </div>
        <div className="action-row">
          <button type="button" className="btn-primary" onClick={() => setPaymentOpen(true)}>
            + Новая выплата
          </button>
          <button type="button" className="btn-secondary" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Обновление…' : 'Обновить'}
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <article className="card stat-card">
          <p className="muted small">Выплачено за период</p>
          <strong>{formatMoney(totalPaid)}</strong>
        </article>
        <article className="card stat-card">
          <p className="muted small">Операций</p>
          <strong>{filteredRecords.length}</strong>
        </article>
      </div>

      <div className="toolbar card">
        <label className="field grow-field">
          <span>С</span>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        </label>
        <label className="field grow-field">
          <span>По</span>
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </label>
        <label className="field grow-field">
          <span>Водитель</span>
          <select
            value={driverFilter}
            onChange={(e) => {
              setDriverFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">Все</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.full_name ?? driver.email}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {filteredRecords.length === 0 ? (
        <p className="empty">Выплат за период нет.</p>
      ) : (
        <>
          <DataTable
            rows={pageRows}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'driver',
                header: 'Водитель',
                render: (row) => (
                  <Link to={`/drivers/${row.driver_id}`} className="table-link">
                    {row.driver_name ?? `#${row.driver_id}`}
                  </Link>
                ),
              },
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
              {
                key: 'note',
                header: 'Комментарий',
                render: (row) => row.note ?? '—',
              },
              {
                key: 'actions',
                header: '',
                className: 'table-actions',
                render: (row) => (
                  <button
                    type="button"
                    className="btn-danger small-btn"
                    disabled={busyId === row.id}
                    onClick={() => onDelete(row)}
                  >
                    Удалить
                  </button>
                ),
              },
            ]}
          />
          {pageCount > 1 ? (
            <div className="pagination-row">
              <button type="button" className="btn-secondary" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Назад</button>
              <span className="muted small">Страница {safePage} из {pageCount}</span>
              <button type="button" className="btn-secondary" disabled={safePage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Вперёд →</button>
            </div>
          ) : null}
        </>
      )}

      <SalaryPaymentModal
        open={paymentOpen}
        drivers={drivers}
        initialDriverId={selectedDriverId}
        initialPeriod={{ from, to }}
        submitting={saving}
        onSubmit={onCreatePayment}
        onClose={() => setPaymentOpen(false)}
      />
    </section>
  );
}
