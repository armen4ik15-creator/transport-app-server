import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { createExpense } from '../api/expenses';
import { apiErrorMessage } from '../api/client';
import { ExpenseForm } from '../components/ExpenseForm';
import type { buildExpensePayload } from '../schemas/expenseSchema';

export function ExpenseCreatePage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (payload: ReturnType<typeof buildExpensePayload>) => {
    setSubmitting(true);
    setError(null);
    try {
      await createExpense(payload);
      toast.success('Расход добавлен');
      navigate('/expenses');
    } catch (err) {
      const message = apiErrorMessage(err, 'Не удалось добавить расход');
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section>
      <div className="page-header">
        <div>
          <h2>Новый расход</h2>
          <p className="muted">Для движения р/с укажите способ оплаты: безнал или наличные.</p>
        </div>
        <Link to="/expenses" className="btn-secondary link-btn">← К списку</Link>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <ExpenseForm submitting={submitting} onSubmit={onSubmit} onCancel={() => navigate('/expenses')} />
    </section>
  );
}
