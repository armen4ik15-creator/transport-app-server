import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { createExpense, deleteExpense, getExpenseById } from '../api/expenses';
import { apiErrorMessage } from '../api/client';
import { ExpenseForm } from '../components/ExpenseForm';
import type { buildExpensePayload } from '../schemas/expenseSchema';
import type { ExpenseRecord } from '../types';

export function ExpenseEditPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const navigate = useNavigate();

  const [record, setRecord] = useState<ExpenseRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      setError('Некорректный ID');
      return;
    }
    const found = await getExpenseById(id);
    if (!found) {
      setError('Расход не найден');
      setRecord(null);
      return;
    }
    setRecord(found);
  }, [id]);

  useEffect(() => {
    load()
      .catch((err) => setError(apiErrorMessage(err, 'Не удалось загрузить расход')))
      .finally(() => setLoading(false));
  }, [load]);

  const onSubmit = async (payload: ReturnType<typeof buildExpensePayload>) => {
    if (!record) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteExpense(record.id);
      await createExpense(payload);
      toast.success('Расход обновлён');
      navigate('/expenses');
    } catch (err) {
      const message = apiErrorMessage(err, 'Не удалось сохранить изменения');
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p className="muted">Загрузка…</p>;

  if (!record) {
    return (
      <section>
        <p className="error">{error ?? 'Расход не найден'}</p>
        <Link to="/expenses" className="btn-secondary link-btn">← К списку</Link>
      </section>
    );
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h2>Редактирование расхода #{record.id}</h2>
          <p className="muted">На сервере нет PUT — запись пересоздаётся (как в mobile).</p>
        </div>
        <Link to="/expenses" className="btn-secondary link-btn">← К списку</Link>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <ExpenseForm initial={record} submitting={submitting} onSubmit={onSubmit} onCancel={() => navigate('/expenses')} />
    </section>
  );
}
