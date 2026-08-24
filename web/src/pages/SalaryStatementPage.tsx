import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { getSalaryStatement } from '../api/salary';
import { apiErrorMessage } from '../api/client';
import { SalaryPeriodFilter, type SalaryPeriodDraft } from '../components/SalaryPeriodFilter';
import { SalaryStatementLedger } from '../components/SalaryStatementLedger';
import { SalaryStatementTrips } from '../components/SalaryStatementTrips';
import { SalarySubNav } from '../components/SalarySubNav';
import {
  defaultSalaryPeriod,
  getSalaryShiftBounds,
  inferShiftFromRange,
  parseMonthKey,
} from '../utils/salaryPeriods';
import { formatMoney } from '../utils/pagination';
import type { DriverSalaryStatement } from '../types';

function draftFromUrl(searchParams: URLSearchParams): SalaryPeriodDraft {
  const fallback = defaultSalaryPeriod();
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

  if (!searchParams.get('from') || !searchParams.get('to')) {
    const parsed = parseMonthKey(monthValue);
    const bounds = parsed ? getSalaryShiftBounds(parsed.year, parsed.month, shift) : null;
    return {
      monthValue,
      shift,
      from: bounds?.from ?? from,
      to: bounds?.to ?? to,
      driverFilter: 'all',
      statusFilter: 'all',
    };
  }

  return {
    monthValue,
    shift,
    from,
    to,
    driverFilter: 'all',
    statusFilter: 'all',
  };
}

export function SalaryStatementPage() {
  const { id: idParam } = useParams();
  const driverId = Number(idParam);
  const [searchParams, setSearchParams] = useSearchParams();
  const initial = draftFromUrl(searchParams);

  const [draft, setDraft] = useState<SalaryPeriodDraft>(initial);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [statement, setStatement] = useState<DriverSalaryStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (periodFrom: string, periodTo: string) => {
      if (!Number.isFinite(driverId) || driverId <= 0) {
        setError('Некорректный ID водителя');
        setStatement(null);
        return;
      }
      setError(null);
      const data = await getSalaryStatement(driverId, periodFrom, periodTo);
      setStatement(data);
    },
    [driverId]
  );

  useEffect(() => {
    setLoading(true);
    load(from, to)
      .catch((err) => setError(apiErrorMessage(err, 'Не удалось загрузить ведомость')))
      .finally(() => setLoading(false));
  }, [from, load, to]);

  const onApply = async () => {
    if (!draft.from || !draft.to || draft.from > draft.to) {
      toast.error('Проверьте период: дата «С» не позже «По»');
      return;
    }
    setApplying(true);
    try {
      setSearchParams({
        from: draft.from,
        to: draft.to,
        month: draft.monthValue,
        shift: String(draft.shift),
      });
      setFrom(draft.from);
      setTo(draft.to);
      await load(draft.from, draft.to);
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
      await load(from, to);
      toast.success('Ведомость обновлена');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Не удалось обновить'));
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <p className="muted">Загрузка зарплатной ведомости…</p>;

  if (error && !statement) {
    return (
      <section className="wide-section">
        <SalarySubNav />
        <p className="error">{error}</p>
        <Link to="/salary" className="btn-secondary">
          ← К начислениям
        </Link>
      </section>
    );
  }

  if (!statement) return null;

  const { totals } = statement;
  const payDueDate = statement.pay_due_date ?? null;
  const payDueLabel = statement.pay_due_label ?? null;
  const payScheduleRule = statement.pay_schedule_rule ?? null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const isPayOverdue =
    Boolean(payDueDate) && totals.debt > 0 && todayIso > String(payDueDate);
  const payStatusLabel =
    totals.debt <= 0
      ? 'Закрыто по вахте'
      : isPayOverdue
        ? 'Просрочена выплата'
        : payDueDate && todayIso <= payDueDate
          ? 'К выплате'
          : null;

  return (
    <section className="wide-section">
      <SalarySubNav />

      <div className="page-header">
        <div>
          <p className="muted small">
            <Link to={`/salary?from=${from}&to=${to}`} className="table-link">
              ← Начисления
            </Link>
            {' · '}
            <Link to={`/drivers/${statement.driver_id}`} className="table-link">
              Карточка водителя
            </Link>
          </p>
          <h2>Зарплатная ведомость</h2>
          <p className="muted">
            {statement.driver_name ?? `#${statement.driver_id}`}
            {statement.driver_car_number ? ` · ${statement.driver_car_number}` : ''}
            {' · '}
            {statement.period_label}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Обновление…' : 'Обновить'}
        </button>
      </div>

      <SalaryPeriodFilter
        draft={draft}
        onChange={setDraft}
        onApply={onApply}
        applying={applying}
        showDriverStatus={false}
        appliedLabel={`Показано: ${from} — ${to}`}
      />

      {error ? <p className="error">{error}</p> : null}

      {payDueLabel ? (
        <article className={`card salary-pay-schedule${isPayOverdue ? ' salary-pay-overdue' : ''}`}>
          <p className="muted small">Срок выплаты по вахте</p>
          <strong>{payDueLabel}</strong>
          {payScheduleRule ? <p className="muted small">{payScheduleRule}</p> : null}
          {payStatusLabel ? (
            <p className={isPayOverdue ? 'error small' : 'muted small'}>{payStatusLabel}</p>
          ) : null}
        </article>
      ) : null}

      <div className="stats-grid">
        <article className="card stat-card">
          <p className="muted small">Итого начислено</p>
          <strong>{formatMoney(totals.accrued)}</strong>
        </article>
        <article className="card stat-card">
          <p className="muted small">Итого выплачено</p>
          <strong>{formatMoney(totals.paid)}</strong>
        </article>
        <article className="card stat-card">
          <p className="muted small">Осталось должны</p>
          <strong>{formatMoney(totals.debt)}</strong>
        </article>
        <article className="card stat-card">
          <p className="muted small">Рейсы в ЗП / без фото</p>
          <strong>
            {totals.trips_counted_count} / {totals.trips_excluded_count}
          </strong>
          {totals.trips_excluded > 0 ? (
            <p className="muted small">не учтено {formatMoney(totals.trips_excluded)}</p>
          ) : null}
        </article>
      </div>

      <h3 className="section-title">Расчёт (как в Excel)</h3>
      <p className="muted small">
        Начислено (+) — что начислили. Выплачено (−) — что уже выдали. Остаток — сколько ещё должны.
      </p>
      <SalaryStatementLedger lines={statement.ledger} />

      <div className="salary-totals-row card">
        <div>
          <span className="muted small">ИТОГО НАЧИСЛЕНО</span>
          <strong>{formatMoney(totals.accrued)}</strong>
        </div>
        <div>
          <span className="muted small">ИТОГО ВЫПЛАЧЕНО</span>
          <strong>{formatMoney(totals.paid)}</strong>
        </div>
        <div>
          <span className="muted small">ОСТАЛОСЬ ДОЛЖНЫ</span>
          <strong>{formatMoney(totals.debt)}</strong>
        </div>
      </div>

      <h3 className="section-title">Рейсы за период</h3>
      <p className="muted small">
        В зарплату входят только рейсы с фото ТТН. Без фото — ставка не начисляется автоматически
        (может быть учтена вручную отдельной строкой).
      </p>
      <SalaryStatementTrips trips={statement.trips} />
    </section>
  );
}
