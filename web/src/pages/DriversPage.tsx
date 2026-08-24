import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { listDrivers } from '../api/drivers';
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
  type DriverArchiveFilter,
  type DriverStatusFilter,
} from '../utils/driverFilters';
import type { Driver } from '../types';

export function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DriverStatusFilter>('all');
  const [archiveFilter, setArchiveFilter] = useState<DriverArchiveFilter>('hide');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDrivers = useCallback(async () => {
    setError(null);
    setDrivers(await listDrivers());
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

  const pageCount = totalPages(filteredDrivers.length);
  const safePage = Math.min(page, pageCount);
  const pageDrivers = paginateItems(filteredDrivers, safePage);

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
            Справочник водителей. Зарплата, ведомости и выплаты — в разделе{' '}
            <Link to="/salary" className="table-link">
              Зарплата
            </Link>
            .
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
          <DataTable<Driver>
            rows={pageDrivers}
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
                key: 'senior',
                header: 'Старший',
                render: (row) =>
                  (row.senior_shift_bonus ?? 0) > 0
                    ? `${formatMoney(row.senior_shift_bonus ?? 0)}/вахта`
                    : '—',
              },
              {
                key: 'actions',
                header: '',
                className: 'table-actions',
                render: (row) => (
                  <div className="action-row compact-row">
                    <Link to={`/drivers/${row.id}`} className="btn-secondary link-btn small-btn">
                      Карточка
                    </Link>
                    {!row.is_archived ? (
                      <Link
                        to={`/salary/drivers/${row.id}`}
                        className="btn-secondary link-btn small-btn"
                      >
                        ЗП
                      </Link>
                    ) : null}
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
