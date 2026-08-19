import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { apiErrorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { user, loading, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    return <Navigate to="/orders" replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError('Введите email или телефон и пароль');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(apiErrorMessage(err, 'Не удалось войти'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="center-page">
      <form className="card login-card" onSubmit={onSubmit}>
        <h1>РеестрПро</h1>
        <p className="muted">Вход для компьютера и планшета</p>
        <p className="hint">
          Те же данные, что в мобильном приложении. Изменения видны и на телефоне, и здесь.
        </p>

        <label className="field">
          <span>Email или телефон</span>
          <input
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            placeholder="admin@example.com"
          />
        </label>

        <label className="field">
          <span>Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>

        {error ? <p className="error">{error}</p> : null}

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
