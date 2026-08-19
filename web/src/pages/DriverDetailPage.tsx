import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { getDriverBalance } from '../api/balances';
import { getDriverById, updateDriver } from '../api/drivers';
import { getEarningsSummary } from '../api/earnings';
import { apiErrorMessage } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable } from '../components/DataTable';
import { DriverSalarySection } from '../components/DriverSalarySection';
import { driverStatusLabel } from '../utils/driverFilters';
import { formatMoney } from '../utils/pagination';
import type { Driver, DriverBalance, EarningsSummary } from '../types';

export function DriverDetailPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);

  const [driver, setDriver] = useState<Driver | null>(null);
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [balance, setBalance] = useState<DriverBalance | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'salary'>('overview');

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      setError('Некорректный ID водителя');
      return;
    }
    setError(null);
    const found = await getDriverById(id);
    if (!found) {
      setDriver(null);
      setError('Водитель не найден');
      return;
    }
    setDriver(found);

    const [earnings, driverBalance] = await Promise.all([
      getEarningsSummary({ driver_id: id }),
      getDriverBalance(id),
    ]);
    setSummary(earnings);
    setBalance(driverBalance);
  }, [id]);

  useEffect(() => {
    load()
      .catch((err) => setError(apiErrorMessage(err, 'Не удалось загрузить карточку')))
      .finally(() => setLoading(false));
  }, [load]);

  const onToggleActive = async (nextActive: boolean) => {
    if (!driver) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateDriver(driver.id, { is_active: nextActive });
      setDriver(updated);
      toast.success(nextActive ? 'Водитель активирован' : 'Водитель деактивирован');
    } catch (err) {
      const message = apiErrorMessage(err, 'Не удалось изменить статус');
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
      setConfirmDeactivate(false);
      setConfirmActivate(false);
    }
  };

  if (loading) {
    return <p className="muted">Загрузка карточки…</p>;
  }

  if (!driver) {
    return (
      <section>
        <p className="error">{error ?? 'Водитель не найден'}</p>
        <Link to="/drivers" className="btn-secondary link-btn">
          ← К списку
        </Link>
      </section>
    );
  }

  const recentTrips = summary?.trips?.slice(0, 10) ?? [];

  return (
    <section className="wide-section">
      <div className="page-header">
        <div>
          <h2>{driver.full_name ?? 'Без имени'}</h2>
          <p className="muted">
            #{driver.id} · {driverStatusLabel(driver.is_active)} · {driver.email}
          </p>
        </div>
        <Link to="/drivers" className="btn-secondary link-btn">
          ← К списку
        </Link>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="sub-nav card">
        <button
          type="button"
          className={activeTab === 'overview' ? 'active' : ''}
          onClick={() => setActiveTab('overview')}
        >
          Обзор
        </button>
        <button
          type="button"
          className={activeTab === 'salary' ? 'active' : ''}
          onClick={() => setActiveTab('salary')}
        >
          Зарплата
        </button>
      </div>

      <div className="action-row">
        <Link to={`/drivers/${driver.id}/edit`} className="btn-primary link-btn">
          Редактировать
        </Link>
        {driver.is_active ? (
          <button
            type="button"
            className="btn-danger"
            disabled={busy}
            onClick={() => setConfirmDeactivate(true)}
          >
            Деактивировать
          </button>
        ) : (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => setConfirmActivate(true)}
          >
            Восстановить
          </button>
        )}
      </div>

      {activeTab === 'overview' ? (
        <>
          <div className="stats-grid">
            <article className="card stat-card">
              <p className="muted small">Рейсов</p>
              <strong>{summary?.total_trips ?? 0}</strong>
            </article>
            <article className="card stat-card">
              <p className="muted small">Заработок (оценка)</p>
              <strong>{formatMoney(summary?.total_earnings ?? summary?.estimated_income ?? 0)}</strong>
            </article>
            <article className="card stat-card">
              <p className="muted small">Баланс (финансы)</p>
              <strong>{formatMoney(balance?.balance ?? 0)}</strong>
            </article>
            <article className="card stat-card">
              <p className="muted small">Объём, м³</p>
              <strong>{summary?.total_volume ?? 0}</strong>
            </article>
          </div>

          <article className="card detail-block">
            <h3>Данные водителя</h3>
            <p>
              <strong>Телефон:</strong> {driver.phone ?? '—'}
            </p>
            <p>
              <strong>Госномер:</strong> {driver.car_number ?? '—'}
            </p>
            <p>
              <strong>ВУ:</strong> {driver.license_number ?? '—'}
              {driver.license_expiry ? ` · до ${driver.license_expiry}` : ''}
            </p>
            <p>
              <strong>Медосмотр:</strong> {driver.medical_check_expiry ?? '—'}
            </p>
            <p>
              <strong>Надбавка «старший»:</strong>{' '}
              {formatMoney(driver.senior_shift_bonus ?? 0)}
            </p>
            <p>
              <strong>Создан:</strong> {new Date(driver.created_at).toLocaleString('ru-RU')}
            </p>
          </article>

          <section className="card form-section">
            <h3>Последние рейсы</h3>
            <DataTable
              rows={recentTrips}
              rowKey={(trip) => trip.id}
              emptyMessage="Рейсов пока нет"
              columns={[
                {
                  key: 'id',
                  header: '№',
                  render: (trip) => (
                    <Link to={`/orders/${trip.order_id}`} className="table-link">
                      #{trip.id}
                    </Link>
                  ),
                },
                {
                  key: 'order',
                  header: 'Заказ',
                  render: (trip) => (
                    <Link to={`/orders/${trip.order_id}`} className="table-link">
                      #{trip.order_id}
                    </Link>
                  ),
                },
                {
                  key: 'ttn',
                  header: 'ТТН',
                  render: (trip) => trip.ttn_number ?? '—',
                },
                {
                  key: 'volume',
                  header: 'Объём',
                  render: (trip) => (trip.volume != null ? String(trip.volume) : '—'),
                },
                {
                  key: 'rate',
                  header: 'Ставка',
                  render: (trip) => formatMoney(trip.driver_rate),
                },
                {
                  key: 'date',
                  header: 'Дата',
                  render: (trip) =>
                    new Date(trip.completed_at ?? trip.created_at).toLocaleDateString('ru-RU'),
                },
              ]}
            />
          </section>
        </>
      ) : (
        <DriverSalarySection driverId={driver.id} />
      )}

      <ConfirmDialog
        open={confirmDeactivate}
        title="Деактивировать водителя?"
        message="Водитель не сможет войти в приложение. Данные и история рейсов сохранятся. Можно восстановить позже."
        confirmLabel="Деактивировать"
        danger
        busy={busy}
        onConfirm={() => onToggleActive(false)}
        onCancel={() => setConfirmDeactivate(false)}
      />

      <ConfirmDialog
        open={confirmActivate}
        title="Восстановить водителя?"
        message="Водитель снова сможет входить в мобильное приложение."
        confirmLabel="Восстановить"
        busy={busy}
        onConfirm={() => onToggleActive(true)}
        onCancel={() => setConfirmActivate(false)}
      />
    </section>
  );
}
