import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { listDrivers } from '../api/drivers';
import { getSalaryDebts } from '../api/salary';
import { apiErrorMessage } from '../api/client';
import { DataTable } from '../components/DataTable';
import {
  formatMoney,
  paginateItems,
  totalPages,
} from '../utils/pagination';
import {
  driverStatusLabel,
  filterDrivers,
  mergeDriverStats,
  type DriverArchiveFilter,
  type DriverStatusFilter,
} from '../utils/driverFilters';
import { formatDriverOwed } from '../utils/driverSalaryDisplay';
import type { Driver, DriverListStats } from '../types';

interface DriverRow extends Driver {
  stats: DriverListStats;
}

export function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [statsMap, setStatsMap] = useState<Record<number, DriverListStats>>({});
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DriverStatusFilter>('all');
  const [archiveFilter, setArchiveFilter] = useState<DriverArchiveFilter>('hide');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDrivers = useCallback(async () => {
    setError(null);
    setStatsLoading(true);
    const [driversList, debts] = await Promise.all([listDrivers(), getSalaryDebts()]);
    setDrivers(driversList);

    const nextStats: Record<number, DriverListStats> = {};
    for (const row of debts) {
      nextStats[row.driver_id] = {
        totalTrips: row.gross_trips,
        gross: row.gross,
        paid: row.paid,
        owed: row.owed ?? Math.max(0, row.debt),
        overpaid: row.overpaid ?? Math.max(0, -row.debt),
        firstTripDate: row.first_trip_date ?? null,
        lastPaymentDate: row.last_payment_date ?? null,
      };
    }
    setStatsMap(nextStats);
    setStatsLoading(false);
  }, []);

  useEffect(() => {
    loadDrivers()
      .catch((err) => setError(apiErrorMessage(err, 'Не удалось загрузить водителей')))
      .finally(() => setLoading(false));
  }, [loadDrivers]);

  const filteredDrivers = useMemo(
    () => filterDrivers(drivers, query, statusFilter, archiveFilter),
    [drivers, query, statusFilter, archiveFilter]
  );

  const totals = useMemo(() => {
    const visibleIds = new Set(filteredDrivers.map((driver) => driver.id));
    return Object.entries(statsMap).reduce(
      (acc, [driverId, stats]) => {
        if (!visibleIds.has(Number(driverId))) return acc;
        acc.gross += stats.gross;
        acc.paid += stats.paid;
        acc.owed += stats.owed;
        return acc;
      },
      { gross: 0, paid: 0, owed: 0 }
    );
  }, [filteredDrivers, statsMap]);

  const pageCount = totalPages(filteredDrivers.length);
  const safePage = Math.min(page, pageCount);
  const pageDrivers = paginateItems(filteredDrivers, safePage);

  const rows: DriverRow[] = pageDrivers.map((driver) => ({
    ...driver,
    stats: mergeDriverStats(driver.id, statsMap),
  }));

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadDrivers();
      toast.success('Список обновлён');
    } catch (err) {
      const message = apiErrorMessage(err, 'Не удалось обновить список');
      setError(message);
      toast.error(message);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return <p className="muted">Загрузка водителей…</p>;
  }

  if (error && drivers.length === 0) {
    return (
      <section>
        <p className="error">{error}</p>
        <button type="button" className="btn-primary" onClick={() => loadDrivers()}>
          Повторить
        </button>
      </section>
    );
  }

  return (
    <section className="wide-section">
      <div className="page-header">
        <div>
          <h2>Водители ({filteredDrivers.length})</h2>
          <p className="muted">
            Зарплата за всё время: рейсы с фото ТТН + компенсации + надбавки + ручные начисления
            − выплаты. «К выплате» — только положительный остаток.
          </p>
        </div>
        <div className="action-row">
          <Link to="/drivers/new" className="btn-primary link-btn">
            + Добавить водителя
          </Link>
          <button type="button" className="btn-secondary" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Обновление…' : 'Обновить'}
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <article className="card stat-card">
          <p className="muted small">Начислено (в списке)</p>
          <strong>{statsLoading ? '…' : formatMoney(totals.gross)}</strong>
        </article>
        <article className="card stat-card">
          <p className="muted small">Выплачено (в списке)</p>
          <strong>{statsLoading ? '…' : formatMoney(totals.paid)}</strong>
        </article>
        <article className="card stat-card">
          <p className="muted small">К выплате (в списке)</p>
          <strong>{statsLoading ? '…' : formatMoney(totals.owed)}</strong>
        </article>
      </div>

      <div className="toolbar card">
        <label className="field grow-field">
          <span>Поиск</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="ФИО, телефон, email, госномер"
          />
        </label>
        <div className="filter-row toolbar-filters">
          {(['all', 'active', 'inactive'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={statusFilter === value ? 'chip active' : 'chip'}
              onClick={() => {
                setStatusFilter(value);
                setPage(1);
              }}
            >
              {value === 'all' ? 'Все' : value === 'active' ? 'Активные' : 'Неактивные'}
            </button>
          ))}
          {(['hide', 'only', 'all'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={archiveFilter === value ? 'chip active' : 'chip'}
              onClick={() => {
                setArchiveFilter(value);
                setPage(1);
              }}
            >
              {value === 'hide' ? 'Без архива' : value === 'only' ? 'Архив' : 'Все + архив'}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {filteredDrivers.length === 0 ? (
        <p className="empty">
          Водителей не найдено.{' '}
          <Link to="/drivers/new">Добавить водителя</Link>
        </p>
      ) : (
        <>
          <DataTable<DriverRow>
            rows={rows}
            rowKey={(row) => row.id}
            emptyMessage="Нет водителей"
            columns={[
              {
                key: 'name',
                header: 'ФИО',
                render: (row) => (
                  <Link to={`/drivers/${row.id}`} className="table-link">
                    {row.full_name ?? 'Без имени'}
                  </Link>
                ),
              },
              {
                key: 'phone',
                header: 'Телефон',
                render: (row) => row.phone ?? '—',
              },
              {
                key: 'car',
                header: 'Госномер',
                render: (row) => row.car_number ?? '—',
              },
              {
                key: 'status',
                header: 'Статус',
                render: (row) => (
                  <span
                    className={
                      row.is_archived
                        ? 'badge badge-muted'
                        : row.is_active
                          ? 'badge badge-success'
                          : 'badge badge-muted'
                    }
                  >
                    {driverStatusLabel(row.is_active, row.is_archived)}
                  </span>
                ),
              },
              {
                key: 'trips',
                header: 'Рейсы в ЗП',
                render: (row) => (statsLoading ? '…' : String(row.stats.totalTrips)),
              },
              {
                key: 'gross',
                header: 'Начислено',
                render: (row) => (statsLoading ? '…' : formatMoney(row.stats.gross)),
              },
              {
                key: 'paid',
                header: 'Выплачено',
                render: (row) => (statsLoading ? '…' : formatMoney(row.stats.paid)),
              },
              {
                key: 'owed',
                header: 'К выплате',
                render: (row) => (statsLoading ? '…' : formatDriverOwed(row.stats.owed)),
              },
              {
                key: 'actions',
                header: '',
                className: 'table-actions',
                render: (row) => (
                  <div className="action-row compact-row">
                    <Link to={`/drivers/${row.id}`} className="btn-secondary link-btn small-btn">
                      Открыть
                    </Link>
                    <Link to={`/drivers/${row.id}/edit`} className="btn-secondary link-btn small-btn">
                      Изменить
                    </Link>
                  </div>
                ),
              },
            ]}
          />

          {pageCount > 1 ? (
            <div className="pagination-row">
              <button
                type="button"
                className="btn-secondary"
                disabled={safePage <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
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
                onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))}
              >
                Вперёд →
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
