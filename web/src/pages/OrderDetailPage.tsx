import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiErrorMessage, resolveUploadUrl } from '../api/client';
import { getOrder, updateOrderStatus, uploadOrderPhoto } from '../api/orders';
import { createOrderTemplateFromOrder } from '../api/orderTemplates';
import { useAuth } from '../auth/AuthContext';
import {
  ORDER_STATUS_LABEL,
  TRIP_STAGE_LABEL,
  type OrderStatus,
  type OrderWithPhotos,
} from '../types';

const STATUSES: OrderStatus[] = ['pending', 'in_progress', 'completed', 'cancelled'];

export function OrderDetailPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [order, setOrder] = useState<OrderWithPhotos | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [showTemplateForm, setShowTemplateForm] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      setError('Некорректный ID заказа');
      return;
    }
    try {
      setError(null);
      setOrder(await getOrder(id));
    } catch (err) {
      setError(apiErrorMessage(err, 'Не удалось загрузить заказ'));
      setOrder(null);
    }
  }, [id]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onSetStatus = async (status: OrderStatus) => {
    if (!window.confirm(`Сменить статус на «${ORDER_STATUS_LABEL[status]}»?`)) return;
    setBusy(true);
    try {
      await updateOrderStatus(id, status);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Не удалось сменить статус'));
    } finally {
      setBusy(false);
    }
  };

  const onPhotoSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadOrderPhoto(id, file);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Не удалось загрузить фото'));
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  };

  const onSaveTemplate = async () => {
    const name = templateName.trim();
    if (!name) {
      setError('Введите название шаблона');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createOrderTemplateFromOrder(id, name);
      setShowTemplateForm(false);
      setTemplateName('');
      window.alert('Шаблон сохранён');
    } catch (err) {
      setError(apiErrorMessage(err, 'Не удалось сохранить шаблон'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="muted">Загрузка заказа…</p>;
  }

  if (!order) {
    return (
      <section>
        <p className="error">{error ?? 'Заказ не найден'}</p>
        <Link to="/orders" className="btn-secondary link-btn">
          ← К списку
        </Link>
      </section>
    );
  }

  const isAdmin = user?.role === 'admin';

  return (
    <section>
      <div className="page-header">
        <div>
          <h2>Заказ #{order.id}</h2>
          <p className="muted">
            Статус: {ORDER_STATUS_LABEL[order.status]} · {order.is_active ? 'Активен' : 'В архиве'}
          </p>
        </div>
        <Link to="/orders" className="btn-secondary link-btn">
          ← К списку
        </Link>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {isAdmin ? (
        <div className="action-row">
          <Link to={`/orders/${order.id}/edit`} className="btn-primary link-btn">
            Редактировать
          </Link>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowTemplateForm((prev) => !prev)}
          >
            Сохранить как шаблон
          </button>
        </div>
      ) : null}

      {showTemplateForm && isAdmin ? (
        <section className="card form-section">
          <label className="field">
            Название шаблона
            <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
          </label>
          <button type="button" className="btn-primary" onClick={onSaveTemplate} disabled={busy}>
            Сохранить шаблон
          </button>
        </section>
      ) : null}

      <article className="card detail-block">
        <p>
          <strong>Контрагент:</strong> {order.contractor_name ?? '—'}
        </p>
        <p>
          <strong>Водитель:</strong> {order.driver_name ?? '—'}
          {order.driver_car_number ? ` (${order.driver_car_number})` : ''}
        </p>
        {order.task_name ? (
          <p>
            <strong>Задача:</strong> {order.task_name}
          </p>
        ) : null}
        {order.material ? (
          <p>
            <strong>Материал:</strong> {order.material}
          </p>
        ) : null}
        {order.quantity != null ? (
          <p>
            <strong>Количество:</strong> {order.quantity} {order.unit ?? ''}
          </p>
        ) : null}
        {(order.load_address || order.unload_address) && (
          <p>
            <strong>Маршрут:</strong> {order.load_address ?? '—'} → {order.unload_address ?? '—'}
          </p>
        )}
        {order.notes ? (
          <p>
            <strong>Примечание:</strong> {order.notes}
          </p>
        ) : null}
      </article>

      <section className="card form-section">
        <h3>Смена статуса</h3>
        <div className="choice-list">
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={order.status === status ? 'chip active' : 'chip'}
              disabled={busy || order.status === status}
              onClick={() => onSetStatus(status)}
            >
              {ORDER_STATUS_LABEL[status]}
            </button>
          ))}
        </div>
      </section>

      <section className="card form-section">
        <h3>Фото заказа</h3>
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onPhotoSelected} />
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          Прикрепить фото
        </button>
        {order.photos.length === 0 ? (
          <p className="muted empty-inline">Фото пока нет</p>
        ) : (
          <div className="photo-grid">
            {order.photos.map((photo) => (
              <a
                key={photo.id}
                href={resolveUploadUrl(photo.file_path)}
                target="_blank"
                rel="noreferrer"
                className="photo-thumb"
              >
                <img src={resolveUploadUrl(photo.file_path)} alt={`Фото заказа ${order.id}`} />
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="card form-section">
        <h3>Рейсы ({order.trips.length})</h3>
        {order.trips.length === 0 ? (
          <p className="muted empty-inline">Рейсов пока нет</p>
        ) : (
          <ul className="list">
            {order.trips.map((trip) => (
              <li key={trip.id} className="list-item card nested-card">
                <div className="row-between">
                  <strong>#{trip.id}</strong>
                  <span className="badge">{TRIP_STAGE_LABEL[trip.stage] ?? trip.stage}</span>
                </div>
                {trip.ttn_number ? <p>ТТН: {trip.ttn_number}</p> : null}
                {trip.volume != null ? <p>Объём: {trip.volume}</p> : null}
                {trip.note ? <p className="muted">{trip.note}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
