import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { getDriverById, updateDriver } from '../api/drivers';
import { getEarningsSummary } from '../api/earnings';
import { getSalarySummary } from '../api/salary';
import { apiErrorMessage } from '../api/client';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DataTable } from '../components/DataTable';
import { DriverSalarySection } from '../components/DriverSalarySection';
import { driverStatusLabel } from '../utils/driverFilters';
import { formatDriverOwed, formatSalaryPeriodHint } from '../utils/driverSalaryDisplay';
import { formatMoney } from '../utils/pagination';
import type { Driver, DriverSalarySummary, EarningsSummary } from '../types';

export function DriverDetailPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);

  const [driver, setDriver] = useState<Driver | null>(null);
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [salarySummary, setSalarySummary] = useState<DriverSalarySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmUnarchive, setConfirmUnarchive] = useState(false);
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

    const [earnings, salary] = await Promise.all([
      getEarningsSummary({ driver_id: id }),
      getSalarySummary(id, { from: '1970-01-01', to: '2099-12-31' }),
    ]);
    setSummary(earnings);
    setSalarySummary(salary);
  }, [id]);

  useEffect(() => {
    load()
      .catch((err) => setError(apiErrorMessage(err, 'Не удалось загрузить карточку')))
      .finally(() => setLoading(false));
  }, [load]);

  const onToggleArchive = async (nextArchived: boolean) => {
    if (!driver) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateDriver(driver.id, {
        is_archived: nextArchived,
        is_active: nextArchived ? false : Boolean(driver.is_active),
      });
      setDriver(updated);
      toast.success(nextArchived ? 'Водитель перенесён в архив' : 'Водитель восстановлен из архива');
    } catch (err) {
      const message = apiErrorMessage(err, 'Не удалось изменить архив');
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
      setConfirmArchive(false);
      setConfirmUnarchive(false);
    }
  };

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
            #{driver.id} · {driverStatusLabel(driver.is_active, driver.is_archived)} · {driver.email}
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
        {driver.is_archived ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => setConfirmUnarchive(true)}
          >
            Вернуть из архива
          </button>
        ) : (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => setConfirmArchive(true)}
          >
            В архив
          </button>
        )}
      </div>

      {activeTab === 'overview' ? (
        <>
          <div className="stats-grid">
            <article className="card stat-card">
              <p className="muted small">Рейсов в ЗП</p>
              <strong>{salarySummary?.gross_trips ?? summary?.eligible_trips ?? 0}</strong>
            </article>
            <article className="card stat-card">
              <p className="muted small">Начислено (всё время)</p>
              <strong>{formatMoney(salarySummary?.gross ?? 0)}</strong>
            </article>
            <article className="card stat-card">
              <p className="muted small">Выплачено</p>
              <strong>{formatMoney(salarySummary?.paid ?? 0)}</strong>
            </article>
            <article className="card stat-card">
              <p className="muted small">К выплате</p>
              <strong>{formatDriverOwed(salarySummary?.owed ?? Math.max(0, salarySummary?.debt ?? 0))}</strong>
            </article>
          </div>

          {salarySummary ? (
            <article className="card detail-block">
              <h3>Зарплата за всё время</h3>
              <p className="muted small">
                {formatSalaryPeriodHint(salarySummary.first_trip_date, salarySummary.last_payment_date)}
              </p>
              <p>
                <strong>Рейсы:</strong> {formatMoney(salarySummary.gross_trips ?? 0)}
                {(salarySummary.senior_allowance ?? 0) > 0
                  ? ` · надбавки: ${formatMoney(salarySummary.senior_allowance ?? 0)}`
                  : ''}
                {(salarySummary.compensations ?? 0) > 0
                  ? ` · компенсации: ${formatMoney(salarySummary.compensations ?? 0)}`
                  : ''}
                {(salarySummary.opening_accrued ?? 0) > 0
                  ? ` · ручное: ${formatMoney(salarySummary.opening_accrued ?? 0)}`
                  : ''}
              </p>
              {(salarySummary.overpaid ?? 0) > 0.01 ? (
                <p className="error small">
                  Переплата {formatMoney(salarySummary.overpaid ?? 0)} — выплат больше, чем начислений в
                  системе. Проверьте рейсы с фото и выплаты.
                </p>
              ) : null}
            </article>
          ) : null}

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

      <ConfirmDialog
        open={confirmArchive}
        title="Перенести в архив?"
        message="Водитель скроется из основного списка и расчёта долгов. История выплат и рейсов сохранится."
        confirmLabel="В архив"
        busy={busy}
        onConfirm={() => onToggleArchive(true)}
        onCancel={() => setConfirmArchive(false)}
      />

      <ConfirmDialog
        open={confirmUnarchive}
        title="Вернуть из архива?"
        message="Водитель снова появится в списке и в расчёте зарплаты."
        confirmLabel="Вернуть"
        busy={busy}
        onConfirm={() => onToggleArchive(false)}
        onCancel={() => setConfirmUnarchive(false)}
      />
    </section>
  );
}
