import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { getSalaryDebts } from '../api/salary';
import { apiErrorMessage } from '../api/client';
import { DataTable } from '../components/DataTable';
import { SalarySubNav } from '../components/SalarySubNav';
import { accrualStatusLabel } from '../constants/salary';
import { formatMoney, paginateItems, totalPages } from '../utils/pagination';
import type { DriverDebtSummary } from '../types';

export function SalaryDebtsPage() {
  const [rows, setRows] = useState<DriverDebtSummary[]>([]);
  const [onlyWithDebt, setOnlyWithDebt] = useState(true);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setRows(await getSalaryDebts());
  }, []);

  useEffect(() => {
    load()
      .catch((err) => setError(apiErrorMessage(err, 'Не удалось загрузить долги')))
      .finally(() => setLoading(false));
  }, [load]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (onlyWithDebt && row.debt <= 0.01) return false;
      return true;
    });
  }, [onlyWithDebt, rows]);

  const pageCount = totalPages(filteredRows.length);
  const safePage = Math.min(page, pageCount);
  const pageRows = paginateItems(filteredRows, safePage);

  const totals = useMemo(() => {
    const withDebt = rows.filter((row) => row.debt > 0.01);
    return {
      gross: rows.reduce((sum, row) => sum + row.gross, 0),
      paid: rows.reduce((sum, row) => sum + row.paid, 0),
      debt: withDebt.reduce((sum, row) => sum + row.debt, 0),
      driversWithDebt: withDebt.length,
    };
  }, [rows]);

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

  if (loading) return <p className="muted">Загрузка долгов…</p>;

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
          <h2>Долги ({filteredRows.length})</h2>
          <p className="muted">Сводная задолженность по всем водителям (за всё время).</p>
        </div>
        <button type="button" className="btn-secondary" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Обновление…' : 'Обновить'}
        </button>
      </div>

      <div className="stats-grid">
        <article className="card stat-card">
          <p className="muted small">Всего начислено</p>
          <strong>{formatMoney(totals.gross)}</strong>
        </article>
        <article className="card stat-card">
          <p className="muted small">Всего выплачено</p>
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
        <label className="field checkbox-field">
          <input
            type="checkbox"
            checked={onlyWithDebt}
            onChange={(e) => {
              setOnlyWithDebt(e.target.checked);
              setPage(1);
            }}
          />
          <span>Только с долгом</span>
        </label>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {filteredRows.length === 0 ? (
        <p className="empty">Задолженностей нет.</p>
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
    </section>
  );
}
