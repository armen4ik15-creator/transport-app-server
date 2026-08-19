import { useCallback, useEffect, useMemo, useState } from 'react';
import { getReportDaily, getReportSummary } from '../api/reports';
import { apiErrorMessage } from '../api/client';
import { DataTable } from '../components/DataTable';
import { SimpleBarChart } from '../components/SimpleBarChart';
import { getReportPeriodBounds, type ReportPeriod } from '../utils/datePeriods';
import { formatMoney } from '../utils/pagination';
import type { ReportDailyDay, ReportSummary } from '../types';

interface MonthRow {
  month: string;
  label: string;
  revenue: number;
  expenses: number;
  profit: number;
}

function aggregateByMonth(days: ReportDailyDay[]): MonthRow[] {
  const map = new Map<string, MonthRow>();
  for (const day of days) {
    const month = day.date.slice(0, 7);
    const existing = map.get(month) ?? {
      month,
      label: month,
      revenue: 0,
      expenses: 0,
      profit: 0,
    };
    existing.revenue += day.revenue;
    existing.expenses += day.costs;
    existing.profit += day.profit;
    map.set(month, existing);
  }
  return [...map.values()].sort((a, b) => b.month.localeCompare(a.month));
}

export function FinancesSummaryPage() {
  const [period, setPeriod] = useState<ReportPeriod>('year');
  const [from, setFrom] = useState(getReportPeriodBounds('year').from);
  const [to, setTo] = useState(getReportPeriodBounds('year').to);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [monthRows, setMonthRows] = useState<MonthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [daily, reportSummary] = await Promise.all([
      getReportDaily({ from, to }),
      getReportSummary({ from, to }),
    ]);
    setSummary(reportSummary);
    setMonthRows(aggregateByMonth(daily.days));
  }, [from, to]);

  useEffect(() => {
    load()
      .catch((err) => setError(apiErrorMessage(err, 'Не удалось загрузить сводку')))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const bounds = getReportPeriodBounds(period);
    setFrom(bounds.from);
    setTo(bounds.to);
  }, [period]);

  const chartItems = useMemo(
    () =>
      [...monthRows]
        .reverse()
        .slice(-6)
        .map((row) => ({
          label: row.label.slice(5),
          income: row.revenue,
          expense: row.expenses,
        })),
    [monthRows]
  );

  if (loading) return <p className="muted">Загрузка финансовой сводки…</p>;

  if (error && !summary) {
    return (
      <section>
        <p className="error">{error}</p>
        <button type="button" className="btn-primary" onClick={() => load()}>Повторить</button>
      </section>
    );
  }

  const revenue = summary?.revenue ?? summary?.income ?? 0;
  const costs = summary?.expense ?? 0;
  const profit = summary?.profit ?? summary?.balance ?? 0;

  return (
    <section className="wide-section">
      <div className="page-header">
        <div>
          <h2>Финансовая сводка</h2>
          <p className="muted">Доходы из завершённых рейсов, расходы — P&L (как в mobile).</p>
        </div>
      </div>

      <div className="filter-row">
        {(['month', 'quarter', 'year'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={period === value ? 'chip active' : 'chip'}
            onClick={() => setPeriod(value)}
          >
            {value === 'month' ? 'Месяц' : value === 'quarter' ? 'Квартал' : 'Год'}
          </button>
        ))}
      </div>

      <div className="toolbar card">
        <label className="field grow-field"><span>С</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field grow-field"><span>По</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button type="button" className="btn-secondary" onClick={() => { setLoading(true); load().finally(() => setLoading(false)); }}>Применить</button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="stats-grid">
        <article className="card stat-card"><p className="muted small">Доходы</p><strong>{formatMoney(revenue)}</strong></article>
        <article className="card stat-card"><p className="muted small">Расходы</p><strong>{formatMoney(costs)}</strong></article>
        <article className="card stat-card"><p className="muted small">Прибыль</p><strong>{formatMoney(profit)}</strong></article>
        <article className="card stat-card"><p className="muted small">Рейсов</p><strong>{summary?.trips_count ?? 0}</strong></article>
      </div>

      <section className="card form-section">
        <h3>Доходы vs расходы</h3>
        <SimpleBarChart items={chartItems} />
      </section>

      <section className="card form-section">
        <h3>По месяцам</h3>
        <DataTable
          rows={monthRows}
          rowKey={(row) => row.month}
          emptyMessage="Нет данных за период"
          columns={[
            { key: 'month', header: 'Месяц', render: (row) => row.label },
            { key: 'revenue', header: 'Доход', render: (row) => formatMoney(row.revenue) },
            { key: 'expenses', header: 'Расход', render: (row) => formatMoney(row.expenses) },
            { key: 'profit', header: 'Прибыль', render: (row) => formatMoney(row.profit) },
          ]}
        />
      </section>
    </section>
  );
}
