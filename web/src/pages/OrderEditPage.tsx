import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { listContractors } from '../api/contractors';
import { listDrivers } from '../api/drivers';
import { listMaterials } from '../api/materials';
import { getOrder, updateOrder } from '../api/orders';
import { apiErrorMessage } from '../api/client';
import {
  OrderFormFields,
  buildOrderPayload,
  defaultOrderFormState,
  type OrderFormState,
} from '../components/OrderFormFields';
import type { Contractor, Driver, Material } from '../types';

export function OrderEditPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const navigate = useNavigate();

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [form, setForm] = useState<OrderFormState>(defaultOrderFormState);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchForm = (patch: Partial<OrderFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      setError('Некорректный ID заказа');
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const [order, driversData, contractorsData, materialsData] = await Promise.all([
        getOrder(id),
        listDrivers(),
        listContractors(),
        listMaterials(),
      ]);
      setDrivers(driversData);
      setContractors(contractorsData);
      setMaterials(materialsData);
      setForm({
        driverId: order.driver_id,
        contractorId: order.contractor_id,
        taskName: order.task_name ?? '',
        sender: order.sender ?? '',
        receiver: order.receiver ?? '',
        plannedVolume: order.total_planned_volume != null ? String(order.total_planned_volume) : '',
        material: order.material ?? '',
        quantity: order.quantity != null ? String(order.quantity) : '',
        unit: order.unit ?? '',
        driverRate: order.driver_rate != null ? String(order.driver_rate) : '',
        companyRate: order.company_rate != null ? String(order.company_rate) : '',
        distanceKm: order.distance_km != null ? String(order.distance_km) : '',
        description: order.description ?? '',
        notes: order.notes ?? '',
        loadAddress: order.load_address ?? '',
        unloadAddress: order.unload_address ?? '',
        amount: order.amount != null ? String(order.amount) : '',
        isActive: Boolean(order.is_active),
      });
    } catch (err) {
      setError(apiErrorMessage(err, 'Не удалось загрузить заказ'));
    }
  }, [id]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.driverId || !form.contractorId) {
      setError('Выберите водителя и контрагента');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateOrder(id, {
        ...buildOrderPayload(form),
        driver_id: form.driverId,
        contractor_id: form.contractorId,
      });
      navigate(`/orders/${id}`);
    } catch (err) {
      setError(apiErrorMessage(err, 'Не удалось обновить заказ'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="muted">Загрузка заказа…</p>;
  }

  if (error && !form.driverId && !form.contractorId) {
    return (
      <section>
        <p className="error">{error}</p>
        <Link to="/orders" className="btn-secondary link-btn">
          ← К списку
        </Link>
      </section>
    );
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h2>Редактирование заказа #{id}</h2>
          <p className="muted">Деактивация — переключите «В архиве» и сохраните.</p>
        </div>
        <Link to={`/orders/${id}`} className="btn-secondary link-btn">
          ← К заказу
        </Link>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <form onSubmit={onSubmit} className="form-stack">
        <OrderFormFields
          form={form}
          onChange={patchForm}
          drivers={drivers}
          contractors={contractors}
          materials={materials}
          showAmount
          showActiveToggle
        />
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Сохранение…' : 'Сохранить изменения'}
        </button>
      </form>
    </section>
  );
}
