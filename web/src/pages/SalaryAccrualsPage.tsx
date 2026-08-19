import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { listDrivers } from '../api/drivers';
import { createSalaryPayment, getSalarySummary } from '../api/salary';
import { apiErrorMessage } from '../api/client';
import { DataTable } from '../components/DataTable';
import { SalaryPaymentModal } from '../components/SalaryPaymentForm';
import { SalarySubNav } from '../components/SalarySubNav';
import { accrualStatusLabel } from '../constants/salary';
import { getReportPeriodBounds } from '../utils/datePeriods';
import { formatMoney, paginateItems, totalPages } from '../utils/pagination';
import type { Driver, DriverSalarySummary } from '../types';

interface AccrualRow extends DriverSalarySummary {
  driver_name: string | null;
  driver_car_number: string | null;
}

export function SalaryAccrualsPage() {
  const defaultPeriod = getReportPeriodBounds('month');
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [rows, setRows] = useState<AccrualRow[]>([]);
  const [from, setFrom] = useState(defaultPeriod.from);
  const [to, setTo] = useState(defaultPeriod.to);
  const [driverFilter, setDriverFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const driverList = drivers.length > 0 ? drivers : await listDrivers();
    if (drivers.length === 0) setDrivers(driverList);

    const activeDrivers = driverList.filter((driver) => driver.is_active);
    const summaries = await Promise.all(
      activeDrivers.map(async (driver) => {
        const summary = await getSalarySummary(driver.id, { from, to });
        return {
          ...summary,
          driver_name: driver.full_name,
          driver_car_number: driver.car_number,
        } satisfies AccrualRow;
      })
    );

    setRows(summaries);
  }, [drivers, from, to]);

  useEffect(() => {
    load()
      .catch((err) => setError(apiErrorMessage(err, 'Не удалось загрузить начисления')))
      .finally(() => setLoading(false));
  }, [load]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (driverFilter !== 'all' && row.driver_id !== Number(driverFilter)) return false;
      if (statusFilter === 'debt' && row.debt <= 0.01) return false;
      if (statusFilter === 'closed' && row.debt > 0.01) return false;
      return row.gross > 0 || row.paid > 0 || row.debt !== 0;
    });
  }, [driverFilter, rows, statusFilter]);

  const pageCount = totalPages(filteredRows.length);
  const safePage = Math.min(page, pageCount);
  const pageRows = paginateItems(filteredRows, safePage);

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => ({
        gross: acc.gross + row.gross,
        paid: acc.paid + row.paid,
        debt: acc.debt + Math.max(0, row.debt),
        driversWithDebt: acc.driversWithDebt + (row.debt > 0.01 ? 1 : 0),
      }),
      { gross: 0, paid: 0, debt: 0, driversWithDebt: 0 }
    );
  }, [filteredRows]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
      toast.success('Данные обновлены');
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

  const selectedDriverId = driverFilter !== 'all' ? Number(driverFilter) : undefined;

  if (loading) return <p className="muted">Загрузка начислений…</p>;

  if (error && rows.length === 0) {
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
          <h2>Начисления ({filteredRows.length})</h2>
          <p className="muted">
            Расчёт по завершённым рейсам, компенсациям и надбавкам за выбранный период.
          </p>
        </div>
        <div className="action-row">
          <button type="button" className="btn-primary" onClick={() => setPaymentOpen(true)}>
            + Выплатить
          </button>
          <button type="button" className="btn-secondary" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Обновление…' : 'Обновить'}
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <article className="card stat-card">
          <p className="muted small">Начислено за период</p>
          <strong>{formatMoney(totals.gross)}</strong>
        </article>
        <article className="card stat-card">
          <p className="muted small">Выплачено</p>
          <strong>{formatMoney(totals.paid)}</strong>
        </article>
        <article className="card stat-card">
          <p className="muted small">Общий долг</p>
          <strong>{formatMoney(totals.debt)}</strong>
        </article>
        <article className="card stat-card">
          <p className="muted small">Водителей с долгом</p>
          <strong>{totals.driversWithDebt}</strong>
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
          <select value={driverFilter} onChange={(e) => { setDriverFilter(e.target.value); setPage(1); }}>
            <option value="all">Все</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.full_name ?? driver.email}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow-field">
          <span>Статус</span>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="all">Все</option>
            <option value="debt">С долгом</option>
            <option value="closed">Закрыто</option>
          </select>
        </label>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {filteredRows.length === 0 ? (
        <p className="empty">Начислений за период нет.</p>
      ) : (
        <>
          <DataTable
            rows={pageRows}
            rowKey={(row) => row.driver_id}
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
                key: 'period',
                header: 'Период',
                render: () => `${from} — ${to}`,
              },
              {
                key: 'gross',
                header: 'Начислено',
                render: (row) => formatMoney(row.gross),
              },
              {
                key: 'paid',
                header: 'Выплачено',
                render: (row) => formatMoney(row.paid),
              },
              {
                key: 'debt',
                header: 'Долг',
                render: (row) => formatMoney(row.debt),
              },
              {
                key: 'type',
                header: 'Тип',
                render: (row) => (
                  <span className="muted small">
                    рейсы {formatMoney(row.gross_trips)}
                    {row.compensations > 0 ? ` · комп. ${formatMoney(row.compensations)}` : ''}
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Статус',
                render: (row) => accrualStatusLabel(row.debt),
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
