import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listOrders } from '../api/orders';
import { apiErrorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ORDER_STATUS_LABEL, type Order } from '../types';

type FilterMode = 'active' | 'archive' | 'all';

export function OrdersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<FilterMode>('active');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setOrders(await listOrders());
    } catch (err) {
      setError(apiErrorMessage(err, 'Не удалось загрузить заказы'));
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

  const visibleOrders = useMemo(() => {
    return orders.filter((order) => {
      if (filter === 'all') return true;
      if (filter === 'active') return Boolean(order.is_active);
      return !order.is_active;
    });
  }, [orders, filter]);

  if (loading && orders.length === 0) {
    return <p className="muted">Загрузка заказов…</p>;
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h2>Заказы ({orders.length})</h2>
          <p className="muted">Общие с мобильным приложением — обновляйте список после действий водителей.</p>
        </div>
        <div className="action-row">
          {isAdmin ? (
            <>
              <Link to="/orders/new" className="btn-primary link-btn">
                + Новый заказ
              </Link>
              <Link to="/order-templates" className="btn-secondary link-btn">
                Шаблоны
              </Link>
            </>
          ) : null}
          <button type="button" className="btn-secondary" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Обновление…' : 'Обновить'}
          </button>
        </div>
      </div>

      <div className="filter-row">
        <button
          type="button"
          className={filter === 'active' ? 'chip active' : 'chip'}
          onClick={() => setFilter('active')}
        >
          Активные
        </button>
        <button
          type="button"
          className={filter === 'archive' ? 'chip active' : 'chip'}
          onClick={() => setFilter('archive')}
        >
          Архив
        </button>
        <button
          type="button"
          className={filter === 'all' ? 'chip active' : 'chip'}
          onClick={() => setFilter('all')}
        >
          Все
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {visibleOrders.length === 0 ? (
        <p className="empty">
          Заказов нет.
          {isAdmin ? (
            <>
              {' '}
              <Link to="/orders/new">Создайте первый заказ</Link> или нажмите «Обновить».
            </>
          ) : (
            ' Если водитель только что создал заказ в телефоне — нажмите «Обновить».'
          )}
        </p>
      ) : (
        <ul className="list">
          {visibleOrders.map((order) => (
            <li key={order.id} className="card list-item">
              <div className="row-between">
                <strong>#{order.id}</strong>
                <span className="badge">{ORDER_STATUS_LABEL[order.status]}</span>
              </div>
              <p className="title">{order.contractor_name ?? 'Без контрагента'}</p>
              <p className="muted">
                Водитель: {order.driver_name ?? '—'}
                {order.driver_car_number ? ` (${order.driver_car_number})` : ''}
              </p>
              {order.material ? <p>Материал: {order.material}</p> : null}
              {order.task_name ? <p className="small">Задача: {order.task_name}</p> : null}
              {(order.load_address || order.unload_address) && (
                <p className="small">
                  {order.load_address ?? '—'} → {order.unload_address ?? '—'}
                </p>
              )}
              {!order.is_active ? <p className="muted small">В архиве</p> : null}
              <div className="action-row">
                <Link to={`/orders/${order.id}`} className="btn-secondary link-btn">
                  Открыть
                </Link>
                {isAdmin ? (
                  <Link to={`/orders/${order.id}/edit`} className="btn-secondary link-btn">
                    Редактировать
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
