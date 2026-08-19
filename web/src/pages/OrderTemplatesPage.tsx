import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiErrorMessage } from '../api/client';
import { createOrderTemplate, deleteOrderTemplate, listOrderTemplates } from '../api/orderTemplates';
import { parseDecimalInput } from '../utils/numbers';
import type { OrderTemplate } from '../types';

export function OrderTemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<OrderTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [material, setMaterial] = useState('');
  const [unit, setUnit] = useState('м3');
  const [quantity, setQuantity] = useState('');
  const [driverRate, setDriverRate] = useState('');
  const [companyRate, setCompanyRate] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [notes, setNotes] = useState('');
  const [description, setDescription] = useState('');
  const [loadAddress, setLoadAddress] = useState('');
  const [unloadAddress, setUnloadAddress] = useState('');

  const load = useCallback(async () => {
    try {
      setError(null);
      setTemplates(await listOrderTemplates());
    } catch (err) {
      setError(apiErrorMessage(err, 'Не удалось загрузить шаблоны'));
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

  const onCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Введите название шаблона');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createOrderTemplate({
        name: name.trim(),
        material: material.trim() || undefined,
        unit: unit.trim() || undefined,
        default_quantity: parseDecimalInput(quantity),
        driver_rate: parseDecimalInput(driverRate),
        company_rate: parseDecimalInput(companyRate),
        distance_km: parseDecimalInput(distanceKm),
        notes: notes.trim() || undefined,
        description: description.trim() || undefined,
        load_address: loadAddress.trim() || undefined,
        unload_address: unloadAddress.trim() || undefined,
      });
      setName('');
      setMaterial('');
      setQuantity('');
      setDriverRate('');
      setCompanyRate('');
      setDistanceKm('');
      setNotes('');
      setDescription('');
      setLoadAddress('');
      setUnloadAddress('');
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Не удалось создать шаблон'));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (item: OrderTemplate) => {
    if (!window.confirm(`Удалить шаблон «${item.name}»?`)) return;
    setError(null);
    try {
      await deleteOrderTemplate(item.id);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Не удалось удалить шаблон'));
    }
  };

  if (loading && templates.length === 0) {
    return <p className="muted">Загрузка шаблонов…</p>;
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h2>Шаблоны заказов</h2>
          <p className="muted">Используйте шаблон при создании нового заказа.</p>
        </div>
        <div className="action-row">
          <button type="button" className="btn-secondary" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Обновление…' : 'Обновить'}
          </button>
          <Link to="/orders" className="btn-secondary link-btn">
            ← К заказам
          </Link>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <form onSubmit={onCreate} className="card form-section form-stack">
        <h3>Новый шаблон</h3>
        <label className="field">
          Название *
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          Материал
          <input value={material} onChange={(e) => setMaterial(e.target.value)} />
        </label>
        <label className="field">
          Ед. измерения
          <input value={unit} onChange={(e) => setUnit(e.target.value)} />
        </label>
        <label className="field">
          Количество по умолчанию
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" />
        </label>
        <label className="field">
          Ставка водителя
          <input value={driverRate} onChange={(e) => setDriverRate(e.target.value)} inputMode="decimal" />
        </label>
        <label className="field">
          Ставка компании
          <input value={companyRate} onChange={(e) => setCompanyRate(e.target.value)} inputMode="decimal" />
        </label>
        <label className="field">
          Плечо, км
          <input value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} inputMode="decimal" />
        </label>
        <label className="field">
          Погрузка
          <input value={loadAddress} onChange={(e) => setLoadAddress(e.target.value)} />
        </label>
        <label className="field">
          Разгрузка
          <input value={unloadAddress} onChange={(e) => setUnloadAddress(e.target.value)} />
        </label>
        <label className="field">
          Описание
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          Примечание
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Сохранение…' : 'Создать шаблон'}
        </button>
      </form>

      {templates.length === 0 ? (
        <p className="empty">Шаблонов пока нет</p>
      ) : (
        <ul className="list">
          {templates.map((item) => (
            <li key={item.id} className="card list-item">
              <div className="row-between">
                <strong>{item.name}</strong>
                {item.contractor_name ? <span className="muted">{item.contractor_name}</span> : null}
              </div>
              {item.material ? <p>Материал: {item.material}</p> : null}
              {(item.load_address || item.unload_address) && (
                <p className="small">
                  {item.load_address ?? '—'} → {item.unload_address ?? '—'}
                </p>
              )}
              <div className="action-row">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => navigate(`/orders/new?templateId=${item.id}`)}
                >
                  Создать заказ
                </button>
                <button type="button" className="btn-secondary" onClick={() => onDelete(item)}>
                  Удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
