import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  approveExpense,
  deleteExpense,
  listExpenses,
  rejectExpense,
} from '../api/expenses';
import { apiErrorMessage } from '../api/client';
import { DataTable } from '../components/DataTable';
import {
  ALL_EXPENSE_TYPES,
  getExpenseMethodLabel,
  getExpenseTypeLabel,
} from '../constants/expenseTypes';
import { summarizeExpensesByType, summarizeExpensesForPnL } from '../utils/expenseClassification';
import { getReportPeriodBounds, todayIso } from '../utils/datePeriods';
import { formatMoney, paginateItems, totalPages } from '../utils/pagination';
import type { ExpenseRecord, ExpenseStatus } from '../types';

function resolveStatus(record: ExpenseRecord): ExpenseStatus {
  return record.status ?? 'approved';
}

function authorLabel(record: ExpenseRecord): string {
  if (record.source === 'driver') return record.driver_name ?? 'Водитель';
  return 'Админ';
}

export function ExpensesPage() {
  const [records, setRecords] = useState<ExpenseRecord[]>([]);
  const [from, setFrom] = useState(getReportPeriodBounds('month').from);
  const [to, setTo] = useState(todayIso());
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setRecords(await listExpenses({ from, to }));
  }, [from, to]);

  useEffect(() => {
    load()
      .catch((err) => setError(apiErrorMessage(err, 'Не удалось загрузить расходы')))
      .finally(() => setLoading(false));
  }, [load]);

  const approvedRecords = useMemo(
    () => records.filter((row) => resolveStatus(row) === 'approved'),
    [records]
  );

  const filteredRecords = useMemo(() => {
    return records.filter((row) => {
      if (typeFilter !== 'all' && row.exp_type !== typeFilter) return false;
      return true;
    });
  }, [records, typeFilter]);

  const pageCount = totalPages(filteredRecords.length);
  const safePage = Math.min(page, pageCount);
  const pageRows = paginateItems(filteredRecords, safePage);

  const pnlSummary = useMemo(() => summarizeExpensesForPnL(approvedRecords), [approvedRecords]);
  const byType = useMemo(() => summarizeExpensesByType(approvedRecords), [approvedRecords]);

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

  const onApprove = async (record: ExpenseRecord) => {
    setBusyId(record.id);
    try {
      await approveExpense(record.id);
      await load();
      toast.success('Расход одобрен');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Не удалось одобрить'));
    } finally {
      setBusyId(null);
    }
  };

  const onReject = async (record: ExpenseRecord) => {
    const reason = window.prompt('Причина отклонения:');
    if (!reason?.trim()) return;
    setBusyId(record.id);
    try {
      await rejectExpense(record.id, reason.trim());
      await load();
      toast.success('Расход отклонён');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Не удалось отклонить'));
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (record: ExpenseRecord) => {
    if (!window.confirm(`Удалить расход ${formatMoney(record.amount)}?`)) return;
    setBusyId(record.id);
    try {
      await deleteExpense(record.id);
      await load();
      toast.success('Расход удалён');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Не удалось удалить'));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p className="muted">Загрузка расходов…</p>;

  if (error && records.length === 0) {
    return (
      <section>
        <p className="error">{error}</p>
        <button type="button" className="btn-primary" onClick={() => load()}>
          Повторить
        </button>
      </section>
    );
  }

  const highlightTypes = ['fuel', 'repair', 'fine', 'salary_other', 'other'] as const;

  return (
    <section className="wide-section">
      <div className="page-header">
        <div>
          <h2>Расходы ({filteredRecords.length})</h2>
          <p className="muted">Одобренные расходы учитываются в P&L и кассе.</p>
        </div>
        <div className="action-row">
          <Link to="/expenses/new" className="btn-primary link-btn">
            + Добавить расход
          </Link>
          <button type="button" className="btn-secondary" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Обновление…' : 'Обновить'}
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <article className="card stat-card">
          <p className="muted small">Всего за период (P&L)</p>
          <strong>{formatMoney(pnlSummary.operating)}</strong>
        </article>
        {highlightTypes.map((type) => (
          <article key={type} className="card stat-card">
            <p className="muted small">{getExpenseTypeLabel(type)}</p>
            <strong>{formatMoney(byType[type] ?? 0)}</strong>
          </article>
        ))}
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
          <span>Категория</span>
          <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="all">Все</option>
            {ALL_EXPENSE_TYPES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {filteredRecords.length === 0 ? (
        <p className="empty">Расходов нет. <Link to="/expenses/new">Добавить расход</Link></p>
      ) : (
        <>
          <DataTable
            rows={pageRows}
            rowKey={(row) => row.id}
            columns={[
              { key: 'date', header: 'Дата', render: (row) => row.exp_date },
              { key: 'type', header: 'Категория', render: (row) => getExpenseTypeLabel(row.exp_type) },
              { key: 'amount', header: 'Сумма', render: (row) => formatMoney(row.amount) },
              {
                key: 'method',
                header: 'Оплата',
                render: (row) => getExpenseMethodLabel(row.method),
              },
              {
                key: 'comment',
                header: 'Описание',
                render: (row) => row.comment ?? '—',
              },
              { key: 'author', header: 'Автор', render: (row) => authorLabel(row) },
              {
                key: 'status',
                header: 'Статус',
                render: (row) => resolveStatus(row),
              },
              {
                key: 'actions',
                header: '',
                className: 'table-actions',
                render: (row) => (
                  <div className="action-row compact-row">
                    {resolveStatus(row) === 'pending' ? (
                      <>
                        <button type="button" className="btn-secondary small-btn" disabled={busyId === row.id} onClick={() => onApprove(row)}>
                          Одобрить
                        </button>
                        <button type="button" className="btn-secondary small-btn" disabled={busyId === row.id} onClick={() => onReject(row)}>
                          Отклонить
                        </button>
                      </>
                    ) : (
                      <Link to={`/expenses/${row.id}/edit`} className="btn-secondary link-btn small-btn">
                        Изменить
                      </Link>
                    )}
                    <button type="button" className="btn-danger small-btn" disabled={busyId === row.id} onClick={() => onDelete(row)}>
                      Удалить
                    </button>
                  </div>
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
    </section>
  );
}
