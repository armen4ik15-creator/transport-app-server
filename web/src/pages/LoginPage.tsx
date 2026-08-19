import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { apiErrorMessage, checkApiHealth, getApiHost, logApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { user, loading, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [apiHint, setApiHint] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkingApi, setCheckingApi] = useState(false);

  if (!loading && user) {
    return <Navigate to="/orders" replace />;
  }

  const onCheckApi = async () => {
    setCheckingApi(true);
    setApiHint(null);
    try {
      const result = await checkApiHealth();
      setApiHint(result.message);
    } finally {
      setCheckingApi(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError('Введите email или телефон и пароль');
      return;
    }
    setError(null);
    setApiHint(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      logApiError('login', err);
      setError(apiErrorMessage(err, 'Не удалось войти'));
    } finally {
      setSubmitting(false);
    }
  };

  const healthUrl = `${getApiHost()}/api/health`;

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
        {apiHint ? (
          <p className={apiHint.includes('доступен') ? 'hint' : 'error'}>{apiHint}</p>
        ) : null}

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Вход…' : 'Войти'}
        </button>

        <div className="login-api-tools">
          <button
            type="button"
            className="btn-secondary"
            onClick={onCheckApi}
            disabled={checkingApi || submitting}
          >
            {checkingApi ? 'Проверка…' : 'Проверить API'}
          </button>
          <a className="small muted" href={healthUrl} target="_blank" rel="noreferrer">
            Открыть /api/health
          </a>
        </div>
      </form>
    </div>
  );
}
