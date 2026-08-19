import { useCallback, useEffect, useMemo, useState } from 'react';
import { listTrips } from '../api/trips';
import { apiErrorMessage } from '../api/client';
import type { TripRecord } from '../types';

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleString('ru-RU');
}

export function TripsPage() {
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setTrips(await listTrips());
    } catch (err) {
      setError(apiErrorMessage(err, 'Не удалось загрузить рейсы'));
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const completedTrips = useMemo(
    () =>
      trips.filter(
        (trip) => trip.stage === 'unloading' || trip.status === 'completed'
      ),
    [trips]
  );

  if (loading && trips.length === 0) {
    return <p className="muted">Загрузка рейсов…</p>;
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h2>Рейсы ({completedTrips.length})</h2>
          <p className="muted">
            Рейс, созданный водителем в телефоне, появится здесь после обновления списка.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Обновление…' : 'Обновить'}
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {completedTrips.length === 0 ? (
        <p className="empty">
          Рейсов пока нет. Когда водитель завершит рейс в приложении — нажмите «Обновить».
        </p>
      ) : (
        <ul className="list">
          {completedTrips.map((trip) => (
            <li key={trip.id} className="card list-item">
              <div className="row-between">
                <strong>Рейс #{trip.id}</strong>
                <span className="badge">{trip.ttn_number ? `ТТН ${trip.ttn_number}` : 'без ТТН'}</span>
              </div>
              <p className="title">
                {trip.driver_name ?? 'Водитель'}
                {trip.driver_car_number ? ` · ${trip.driver_car_number}` : ''}
              </p>
              <p className="muted">
                Заказ #{trip.order_id}
                {trip.contractor_name ? ` · ${trip.contractor_name}` : ''}
              </p>
              {trip.material ? <p>Материал: {trip.material}</p> : null}
              <p>
                Объём: {trip.volume != null ? `${trip.volume} м³` : '—'}
                {trip.photo_available ? ' · фото есть' : ' · без фото'}
              </p>
              <p className="small">{formatDate(trip.completed_at ?? trip.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
