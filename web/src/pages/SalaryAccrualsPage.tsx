import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { listDrivers } from '../api/drivers';
import { createSalaryPayment, getSalarySummary } from '../api/salary';
import { apiErrorMessage } from '../api/client';
import { DataTable } from '../components/DataTable';
import { SalaryPaymentModal } from '../components/SalaryPaymentForm';
import { SalaryPeriodFilter, type SalaryPeriodDraft } from '../components/SalaryPeriodFilter';
import { SalarySubNav } from '../components/SalarySubNav';
import { accrualStatusLabel } from '../constants/salary';
import {
  defaultSalaryPeriod,
  getSalaryShiftBounds,
  inferShiftFromRange,
  parseMonthKey,
} from '../utils/salaryPeriods';
import { formatMoney, paginateItems, totalPages } from '../utils/pagination';
import type { Driver, DriverSalarySummary } from '../types';

interface AccrualRow extends DriverSalarySummary {
  driver_name: string | null;
  driver_car_number: string | null;
  is_active: boolean;
}

/** Неактивные без начислений за период (выездной мастер и т.п.) — не в вахтовой ЗП. */
function isPayrollRelevantForPeriod(row: AccrualRow): boolean {
  if (row.is_active) return true;
  return row.gross > 0.01;
}

function buildDraftFromParams(
  searchParams: URLSearchParams,
  fallback: ReturnType<typeof defaultSalaryPeriod>
): SalaryPeriodDraft {
  const from = searchParams.get('from') || fallback.from;
  const to = searchParams.get('to') || fallback.to;
  const inferred = inferShiftFromRange(from, to);
  const monthValue =
    searchParams.get('month') ||
    inferred?.monthValue ||
    `${fallback.year}-${String(fallback.month).padStart(2, '0')}`;
  const shiftParam = searchParams.get('shift');
  const shift =
    shiftParam === '1' || shiftParam === '2'
      ? (Number(shiftParam) as 1 | 2)
      : shiftParam === 'month'
        ? 'month'
        : inferred?.shift ?? fallback.shift;

  const bounds = (() => {
    const parsed = parseMonthKey(monthValue);
    if (!parsed) return { from, to };
    return getSalaryShiftBounds(parsed.year, parsed.month, shift) ?? { from, to };
  })();

  return {
    monthValue,
    shift,
    from: searchParams.get('from') ? from : bounds.from,
    to: searchParams.get('to') ? to : bounds.to,
    driverFilter: searchParams.get('driver') || 'all',
    statusFilter: searchParams.get('status') || 'all',
  };
}

export function SalaryAccrualsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const fallback = defaultSalaryPeriod();
  const initial = buildDraftFromParams(searchParams, fallback);

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [rows, setRows] = useState<AccrualRow[]>([]);
  const [draft, setDraft] = useState<SalaryPeriodDraft>(initial);
  const [applied, setApplied] = useState<SalaryPeriodDraft>(initial);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (period: SalaryPeriodDraft) => {
      setError(null);
      const driverList = drivers.length > 0 ? drivers : await listDrivers();
      if (drivers.length === 0) setDrivers(driverList);

      const visibleDrivers = driverList.filter((driver) => !driver.is_archived);
      const summaries = await Promise.all(
        visibleDrivers.map(async (driver) => {
          const summary = await getSalarySummary(driver.id, {
            from: period.from,
            to: period.to,
          });
          return {
            ...summary,
            driver_name: driver.full_name,
            driver_car_number: driver.car_number,
            is_active: Boolean(driver.is_active),
          } satisfies AccrualRow;
        })
      );

      setRows(summaries.filter(isPayrollRelevantForPeriod));
    },
    [drivers]
  );

  useEffect(() => {
    load(applied)
      .catch((err) => setError(apiErrorMessage(err, 'Не удалось загрузить начисления')))
      .finally(() => setLoading(false));
    // только первый mount / смена applied через apply
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (applied.driverFilter !== 'all' && row.driver_id !== Number(applied.driverFilter)) {
        return false;
      }
      if (applied.statusFilter === 'debt' && row.debt <= 0.01) return false;
      if (applied.statusFilter === 'closed' && row.debt > 0.01) return false;
      return row.gross > 0 || row.paid > 0 || row.debt !== 0;
    });
  }, [applied.driverFilter, applied.statusFilter, rows]);

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

  const syncUrl = (period: SalaryPeriodDraft) => {
    const params: Record<string, string> = {
      from: period.from,
      to: period.to,
      month: period.monthValue,
      shift: String(period.shift),
    };
    if (period.driverFilter !== 'all') params.driver = period.driverFilter;
    if (period.statusFilter !== 'all') params.status = period.statusFilter;
    setSearchParams(params);
  };

  const onApply = async () => {
    if (!draft.from || !draft.to || draft.from > draft.to) {
      toast.error('Проверьте период: дата «С» не позже «По»');
      return;
    }
    setApplying(true);
    setPage(1);
    try {
      await load(draft);
      setApplied(draft);
      syncUrl(draft);
      toast.success('Фильтр применён');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Не удалось применить фильтр'));
    } finally {
      setApplying(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load(applied);
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
      await load(applied);
      setPaymentOpen(false);
      toast.success('Выплата сохранена');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Не удалось сохранить выплату'));
    } finally {
      setSaving(false);
    }
  };

  const selectedDriverId =
    applied.driverFilter !== 'all' ? Number(applied.driverFilter) : undefined;

  if (loading) return <p className="muted">Загрузка начислений…</p>;

  if (error && rows.length === 0) {
    return (
      <section className="wide-section">
        <SalarySubNav />
        <p className="error">{error}</p>
        <button type="button" className="btn-primary" onClick={() => load(applied)}>
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
            Начисления за вахту/месяц по водителям с рейсами. Неактивные без начислений (например
            выездной мастер) скрыты — их оплату учитывайте как расход «услуги». Общий баланс — в{' '}
            <Link to="/salary/debts" className="table-link">
              Долгах
            </Link>
            .
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

      <SalaryPeriodFilter
        draft={draft}
        onChange={setDraft}
        onApply={onApply}
        applying={applying}
        drivers={drivers}
        appliedLabel={`Показано: ${applied.from} — ${applied.to}`}
      />

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
                  <Link
                    to={`/salary/drivers/${row.driver_id}?from=${applied.from}&to=${applied.to}`}
                    className="table-link"
                  >
                    {row.driver_name ?? `#${row.driver_id}`}
                  </Link>
                ),
              },
              {
                key: 'period',
                header: 'Период',
                render: () => `${applied.from} — ${applied.to}`,
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
                header: 'Остаток',
                render: (row) => formatMoney(Math.max(0, row.debt)),
              },
              {
                key: 'type',
                header: 'Из чего',
                render: (row) => (
                  <span className="muted small">
                    рейсы {formatMoney(row.gross_trips)}
                    {row.senior_allowance > 0
                      ? ` · старший ${formatMoney(row.senior_allowance)}`
                      : ''}
                    {row.compensations > 0 ? ` · комп. ${formatMoney(row.compensations)}` : ''}
                    {(row.opening_accrued ?? 0) > 0
                      ? ` · закрытие ${formatMoney(row.opening_accrued ?? 0)}`
                      : ''}
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
              <button
                type="button"
                className="btn-secondary"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Назад
              </button>
              <span className="muted small">
                Страница {safePage} из {pageCount}
              </span>
              <button
                type="button"
                className="btn-secondary"
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Вперёд →
              </button>
            </div>
          ) : null}
        </>
      )}

      <SalaryPaymentModal
        open={paymentOpen}
        drivers={drivers}
        initialDriverId={selectedDriverId}
        initialPeriod={{ from: applied.from, to: applied.to }}
        submitting={saving}
        onSubmit={onCreatePayment}
        onClose={() => setPaymentOpen(false)}
      />
    </section>
  );
}
