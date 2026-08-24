import {
  formatMonthLabel,
  getSalaryShiftBounds,
  listMonthOptions,
  parseMonthKey,
  shiftMonth,
  type SalaryShiftFilter,
} from '../utils/salaryPeriods';
import { formatPayScheduleHint } from '../utils/salaryPaySchedule';

export interface SalaryPeriodDraft {
  monthValue: string;
  shift: SalaryShiftFilter;
  from: string;
  to: string;
  driverFilter: string;
  statusFilter: string;
}

interface SalaryPeriodFilterProps {
  draft: SalaryPeriodDraft;
  onChange: (next: SalaryPeriodDraft) => void;
  onApply: () => void;
  applying?: boolean;
  drivers?: Array<{ id: number; full_name: string | null; email: string }>;
  showDriverStatus?: boolean;
  appliedLabel?: string;
}

function withShift(draft: SalaryPeriodDraft, shift: SalaryShiftFilter): SalaryPeriodDraft {
  const parsed = parseMonthKey(draft.monthValue);
  if (!parsed) return { ...draft, shift };
  const bounds = getSalaryShiftBounds(parsed.year, parsed.month, shift);
  if (!bounds) return { ...draft, shift };
  return {
    ...draft,
    shift,
    from: bounds.from,
    to: bounds.to,
  };
}

function withMonth(draft: SalaryPeriodDraft, monthValue: string): SalaryPeriodDraft {
  const parsed = parseMonthKey(monthValue);
  if (!parsed) return { ...draft, monthValue };
  const bounds = getSalaryShiftBounds(parsed.year, parsed.month, draft.shift);
  if (!bounds) return { ...draft, monthValue };
  return {
    ...draft,
    monthValue,
    from: bounds.from,
    to: bounds.to,
  };
}

export function SalaryPeriodFilter({
  draft,
  onChange,
  onApply,
  applying = false,
  drivers = [],
  showDriverStatus = true,
  appliedLabel,
}: SalaryPeriodFilterProps) {
  const monthOptions = listMonthOptions();
  const parsed = parseMonthKey(draft.monthValue);
  const payScheduleHint =
    draft.shift === 1 || draft.shift === 2
      ? formatPayScheduleHint(draft.from, draft.to)
      : null;

  const goMonth = (delta: number) => {
    if (!parsed) return;
    const next = shiftMonth(parsed.year, parsed.month, delta);
    onChange(withMonth(draft, `${next.year}-${String(next.month).padStart(2, '0')}`));
  };

  return (
    <div className="toolbar card salary-period-filter">
      <div className="salary-period-row">
        <div className="action-row salary-month-nav">
          <button type="button" className="btn-secondary" onClick={() => goMonth(-1)} disabled={applying}>
            ← Пред. месяц
          </button>
          <label className="field grow-field">
            <span>Месяц</span>
            <select
              value={draft.monthValue}
              onChange={(e) => onChange(withMonth(draft, e.target.value))}
              disabled={applying}
            >
              {monthOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-secondary" onClick={() => goMonth(1)} disabled={applying}>
            След. месяц →
          </button>
        </div>

        <div className="filter-row toolbar-filters">
          <button
            type="button"
            className={draft.shift === 1 ? 'chip active' : 'chip'}
            onClick={() => onChange(withShift(draft, 1))}
            disabled={applying}
          >
            Вахта 1 (1–15)
          </button>
          <button
            type="button"
            className={draft.shift === 2 ? 'chip active' : 'chip'}
            onClick={() => onChange(withShift(draft, 2))}
            disabled={applying}
          >
            Вахта 2 (16–конец)
          </button>
          <button
            type="button"
            className={draft.shift === 'month' ? 'chip active' : 'chip'}
            onClick={() => onChange(withShift(draft, 'month'))}
            disabled={applying}
          >
            Весь месяц
          </button>
        </div>
      </div>

      <label className="field grow-field">
        <span>С</span>
        <input
          type="date"
          value={draft.from}
          onChange={(e) => onChange({ ...draft, from: e.target.value })}
          disabled={applying}
        />
      </label>
      <label className="field grow-field">
        <span>По</span>
        <input
          type="date"
          value={draft.to}
          onChange={(e) => onChange({ ...draft, to: e.target.value })}
          disabled={applying}
        />
      </label>

      {showDriverStatus ? (
        <>
          <label className="field grow-field">
            <span>Водитель</span>
            <select
              value={draft.driverFilter}
              onChange={(e) => onChange({ ...draft, driverFilter: e.target.value })}
              disabled={applying}
            >
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
            <select
              value={draft.statusFilter}
              onChange={(e) => onChange({ ...draft, statusFilter: e.target.value })}
              disabled={applying}
            >
              <option value="all">Все</option>
              <option value="debt">С долгом</option>
              <option value="closed">Закрыто</option>
            </select>
          </label>
        </>
      ) : null}

      <button type="button" className="btn-primary" onClick={onApply} disabled={applying}>
        {applying ? 'Загрузка…' : 'Применить'}
      </button>

      {appliedLabel || parsed ? (
        <p className="muted small salary-period-hint">
          {appliedLabel
            ?? `Выбрано: ${formatMonthLabel(parsed!.year, parsed!.month)} · ${
              draft.shift === 1 ? 'вахта 1' : draft.shift === 2 ? 'вахта 2' : 'весь месяц'
            } (${draft.from} — ${draft.to}). Нажмите «Применить».`}
        </p>
      ) : null}
      {payScheduleHint ? (
        <p className="muted small salary-period-hint">{payScheduleHint}</p>
      ) : null}
    </div>
  );
}
