import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { listContractorPayments, createContractorPayment } from '../api/contractorPayments';
import { getCompanyCashSummary } from '../api/companyCash';
import { createExpense, listExpenses } from '../api/expenses';
import { listContractors } from '../api/contractors';
import { apiErrorMessage } from '../api/client';
import { DataTable } from '../components/DataTable';
import { ALL_EXPENSE_TYPES } from '../constants/expenseTypes';
import {
  cashInflowSchema,
  cashOutflowSchema,
  defaultCashInflowValues,
  defaultCashOutflowValues,
  type CashInflowFormValues,
  type CashOutflowFormValues,
} from '../schemas/cashOperationSchema';
import { formatMoney, paginateItems, totalPages } from '../utils/pagination';
import type { CompanyCashSummary, Contractor, ContractorPayment, ExpenseRecord } from '../types';

type FlowFilter = 'all' | 'in' | 'out';
type AccountFilter = 'all' | 'cash' | 'noncash';

interface CashOperationRow {
  id: string;
  date: string;
  type: 'in' | 'out';
  account: 'cash' | 'noncash' | 'other';
  amount: number;
  description: string;
}

function mapExpenseToRow(record: ExpenseRecord): CashOperationRow | null {
  if (record.method !== 'cash' && record.method !== 'noncash') return null;
  if (record.status && record.status !== 'approved') return null;
  return {
    id: `expense-${record.id}`,
    date: record.exp_date,
    type: 'out',
    account: record.method,
    amount: record.amount,
    description: record.comment ?? ALL_EXPENSE_TYPES.find((t) => t.value === record.exp_type)?.label ?? record.exp_type,
  };
}

function mapPaymentToRow(payment: ContractorPayment): CashOperationRow {
  return {
    id: `payment-${payment.id}`,
    date: payment.payment_date ?? payment.created_at.slice(0, 10),
    type: 'in',
    account: 'noncash',
    amount: payment.amount,
    description: payment.note ? `${payment.contractor_name}: ${payment.note}` : payment.contractor_name,
  };
}

export function CashPage() {
  const [summary, setSummary] = useState<CompanyCashSummary | null>(null);
  const [operations, setOperations] = useState<CashOperationRow[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [flowFilter, setFlowFilter] = useState<FlowFilter>('all');
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'out' | 'in'>('out');
  const [submitting, setSubmitting] = useState(false);

  const outflowForm = useForm<CashOutflowFormValues>({
    resolver: zodResolver(cashOutflowSchema),
    defaultValues: defaultCashOutflowValues,
  });

  const inflowForm = useForm<CashInflowFormValues>({
    resolver: zodResolver(cashInflowSchema),
    defaultValues: defaultCashInflowValues,
  });

  const load = useCallback(async () => {
    setError(null);
    const [cashSummary, expenses, payments, contractorsData] = await Promise.all([
      getCompanyCashSummary(),
      listExpenses(),
      listContractorPayments(),
      listContractors(),
    ]);
    setSummary(cashSummary);
    setContractors(contractorsData);
    const rows = [
      ...expenses.map(mapExpenseToRow).filter((row): row is CashOperationRow => row != null),
      ...payments.map(mapPaymentToRow),
    ].sort((a, b) => b.date.localeCompare(a.date));
    setOperations(rows);
  }, []);

  useEffect(() => {
    load()
      .catch((err) => setError(apiErrorMessage(err, 'Не удалось загрузить кассу')))
      .finally(() => setLoading(false));
  }, [load]);

  const filtered = useMemo(() => {
    return operations.filter((row) => {
      if (flowFilter !== 'all' && row.type !== flowFilter) return false;
      if (accountFilter !== 'all' && row.account !== accountFilter) return false;
      return true;
    });
  }, [operations, flowFilter, accountFilter]);

  const pageCount = totalPages(filtered.length);
  const safePage = Math.min(page, pageCount);
  const pageRows = paginateItems(filtered, safePage);

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

  const onSubmitOutflow = outflowForm.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await createExpense({
        exp_date: values.exp_date,
        exp_type: values.exp_type,
        method: values.method,
        amount: values.amount,
        comment: values.comment?.trim() || undefined,
      });
      outflowForm.reset(defaultCashOutflowValues);
      await load();
      toast.success('Расход добавлен');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Не удалось добавить операцию'));
    } finally {
      setSubmitting(false);
    }
  });

  const onSubmitInflow = inflowForm.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await createContractorPayment({
        contractor_id: values.contractor_id,
        amount: values.amount,
        payment_date: values.payment_date,
        note: values.note?.trim() || undefined,
      });
      inflowForm.reset(defaultCashInflowValues);
      await load();
      toast.success('Приход добавлен');
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Не удалось добавить приход'));
    } finally {
      setSubmitting(false);
    }
  });

  if (loading) return <p className="muted">Загрузка кассы…</p>;

  if (error && !summary) {
    return (
      <section>
        <p className="error">{error}</p>
        <button type="button" className="btn-primary" onClick={() => load()}>Повторить</button>
      </section>
    );
  }

  const cashBalance = summary?.estimated_cash_balance ?? 0;
  const bankOut = summary?.bank_settlement_out ?? 0;
  const cashOut = summary?.cash_desk_out ?? 0;

  return (
    <section className="wide-section">
      <div className="page-header">
        <div>
          <h2>Касса и р/с</h2>
          <p className="muted">Оценка баланса с даты открытия: {summary?.opening_cash_date ?? 'не задана'}.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Обновление…' : 'Обновить'}
        </button>
      </div>

      <div className="stats-grid">
        <article className="card stat-card">
          <p className="muted small">Оценка р/с</p>
          <strong>{formatMoney(cashBalance)}</strong>
        </article>
        <article className="card stat-card">
          <p className="muted small">Списания с р/с</p>
          <strong>{formatMoney(bankOut)}</strong>
        </article>
        <article className="card stat-card">
          <p className="muted small">Списания наличными</p>
          <strong>{formatMoney(cashOut)}</strong>
        </article>
        <article className="card stat-card">
          <p className="muted small">Приходы от контрагентов</p>
          <strong>{formatMoney(summary?.payments_in ?? 0)}</strong>
        </article>
      </div>

      <section className="card form-section">
        <h3>Добавить операцию</h3>
        <div className="filter-row">
          <button type="button" className={mode === 'out' ? 'chip active' : 'chip'} onClick={() => setMode('out')}>Расход</button>
          <button type="button" className={mode === 'in' ? 'chip active' : 'chip'} onClick={() => setMode('in')}>Приход</button>
        </div>

        {mode === 'out' ? (
          <form className="form-grid" onSubmit={onSubmitOutflow}>
            <label className="field"><span>Дата</span><input type="date" {...outflowForm.register('exp_date')} /></label>
            <label className="field">
              <span>Счёт</span>
              <select {...outflowForm.register('method')}>
                <option value="noncash">Безнал (р/с)</option>
                <option value="cash">Наличные</option>
              </select>
            </label>
            <label className="field">
              <span>Категория</span>
              <select {...outflowForm.register('exp_type')}>
                {ALL_EXPENSE_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Сумма</span>
              <input type="number" step="0.01" min={0} {...outflowForm.register('amount', { setValueAs: (v) => Number(v) })} />
            </label>
            <label className="field"><span>Описание</span><input {...outflowForm.register('comment')} /></label>
            <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Сохранение…' : 'Добавить расход'}</button>
          </form>
        ) : (
          <form className="form-grid" onSubmit={onSubmitInflow}>
            <label className="field">
              <span>Контрагент</span>
              <select {...inflowForm.register('contractor_id', { setValueAs: (v) => Number(v) })}>
                <option value={0}>Выберите…</option>
                {contractors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Дата</span><input type="date" {...inflowForm.register('payment_date')} /></label>
            <label className="field"><span>Сумма</span><input type="number" step="0.01" min={0} {...inflowForm.register('amount', { setValueAs: (v) => Number(v) })} /></label>
            <label className="field"><span>Описание</span><input {...inflowForm.register('note')} /></label>
            <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Сохранение…' : 'Добавить приход'}</button>
          </form>
        )}
      </section>

      <div className="filter-row">
        {(['all', 'in', 'out'] as const).map((value) => (
          <button key={value} type="button" className={flowFilter === value ? 'chip active' : 'chip'} onClick={() => { setFlowFilter(value); setPage(1); }}>
            {value === 'all' ? 'Все' : value === 'in' ? 'Приход' : 'Расход'}
          </button>
        ))}
        {(['all', 'cash', 'noncash'] as const).map((value) => (
          <button key={value} type="button" className={accountFilter === value ? 'chip active' : 'chip'} onClick={() => { setAccountFilter(value); setPage(1); }}>
            {value === 'all' ? 'Все счета' : value === 'cash' ? 'Наличные' : 'Безнал'}
          </button>
        ))}
      </div>

      {error ? <p className="error">{error}</p> : null}

      <DataTable
        rows={pageRows}
        rowKey={(row) => row.id}
        emptyMessage="Операций пока нет"
        columns={[
          { key: 'date', header: 'Дата', render: (row) => row.date },
          { key: 'type', header: 'Тип', render: (row) => (row.type === 'in' ? 'Приход' : 'Расход') },
          { key: 'account', header: 'Счёт', render: (row) => (row.account === 'cash' ? 'Наличные' : row.account === 'noncash' ? 'Безнал' : '—') },
          { key: 'amount', header: 'Сумма', render: (row) => formatMoney(row.amount) },
          { key: 'desc', header: 'Описание', render: (row) => row.description },
        ]}
      />
    </section>
  );
}
