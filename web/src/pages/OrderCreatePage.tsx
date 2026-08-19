import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { listContractors } from '../api/contractors';
import { listDrivers } from '../api/drivers';
import { listMaterials } from '../api/materials';
import { createOrder, createOrdersBulk } from '../api/orders';
import { createOrderTemplate, listOrderTemplates } from '../api/orderTemplates';
import { apiErrorMessage } from '../api/client';
import {
  OrderFormFields,
  applyTemplateToForm,
  buildOrderPayload,
  defaultOrderFormState,
  type OrderFormState,
} from '../components/OrderFormFields';
import type { Contractor, Driver, Material, OrderTemplate } from '../types';

export function OrderCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const templateIdParam = searchParams.get('templateId');

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [templates, setTemplates] = useState<OrderTemplate[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [form, setForm] = useState<OrderFormState>(defaultOrderFormState);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [createForAllDrivers, setCreateForAllDrivers] = useState(false);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchForm = (patch: Partial<OrderFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const load = useCallback(async () => {
    try {
      setError(null);
      const [driversData, contractorsData, templatesData, materialsData] = await Promise.all([
        listDrivers(),
        listContractors(),
        listOrderTemplates(),
        listMaterials(),
      ]);
      setDrivers(driversData);
      setContractors(contractorsData);
      setTemplates(templatesData);
      setMaterials(materialsData);
    } catch (err) {
      setError(apiErrorMessage(err, 'Не удалось загрузить данные формы'));
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (!templateIdParam || templates.length === 0) return;
    const id = Number(templateIdParam);
    if (!Number.isFinite(id)) return;
    const tpl = templates.find((item) => item.id === id);
    if (!tpl) return;
    setSelectedTemplateId(tpl.id);
    patchForm(applyTemplateToForm(tpl));
  }, [templateIdParam, templates]);

  const onSelectTemplate = (tpl: OrderTemplate) => {
    setSelectedTemplateId(tpl.id);
    patchForm(applyTemplateToForm(tpl));
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.contractorId) {
      setError('Выберите контрагента');
      return;
    }
    if (!createForAllDrivers && !form.driverId) {
      setError('Выберите водителя или включите «Назначить всем»');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = buildOrderPayload(form);
      if (createForAllDrivers) {
        await createOrdersBulk({
          ...payload,
          driver_ids: drivers.map((item) => item.id),
        });
      } else {
        await createOrder({
          ...payload,
          driver_id: form.driverId as number,
        });
      }

      if (saveAsTemplate && templateName.trim()) {
        await createOrderTemplate({
          name: templateName.trim(),
          contractor_id: form.contractorId,
          material: form.material.trim() || undefined,
          unit: form.unit.trim() || undefined,
          default_quantity: payload.quantity,
          driver_rate: payload.driver_rate,
          company_rate: payload.company_rate,
          distance_km: payload.distance_km,
          notes: form.notes.trim() || undefined,
          description: form.description.trim() || undefined,
          load_address: form.loadAddress.trim() || undefined,
          unload_address: form.unloadAddress.trim() || undefined,
        });
      }

      navigate('/orders');
    } catch (err) {
      setError(apiErrorMessage(err, 'Не удалось создать заказ'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="muted">Загрузка формы…</p>;
  }

  return (
    <section>
      <div className="page-header">
        <div>
          <h2>Новый заказ</h2>
          <p className="muted">Те же поля, что в мобильном приложении.</p>
        </div>
        <Link to="/orders" className="btn-secondary link-btn">
          ← К списку
        </Link>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <form onSubmit={onSubmit} className="form-stack">
        <section className="card form-section">
          <h3>Шаблон заказа</h3>
          <div className="choice-list">
            <button
              type="button"
              className={selectedTemplateId === null ? 'chip active' : 'chip'}
              onClick={() => {
                setSelectedTemplateId(null);
                patchForm({
                  material: '',
                  unit: 'м3',
                  quantity: '',
                  driverRate: '',
                  companyRate: '',
                  distanceKm: '',
                  notes: '',
                  description: '',
                  loadAddress: '',
                  unloadAddress: '',
                });
              }}
            >
              Без шаблона
            </button>
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className={selectedTemplateId === tpl.id ? 'chip active' : 'chip'}
                onClick={() => onSelectTemplate(tpl)}
              >
                {tpl.name}
              </button>
            ))}
          </div>
          <Link to="/order-templates" className="small muted">
            Управление шаблонами
          </Link>
        </section>

        <OrderFormFields
          form={form}
          onChange={patchForm}
          drivers={drivers}
          contractors={contractors}
          materials={materials}
          createForAllDrivers={createForAllDrivers}
          onToggleAllDrivers={() => setCreateForAllDrivers((prev) => !prev)}
        />

        <section className="card form-section">
          <h3>Сохранить как шаблон</h3>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={saveAsTemplate}
              onChange={(e) => setSaveAsTemplate(e.target.checked)}
            />
            Сохранить форму как новый шаблон
          </label>
          {saveAsTemplate ? (
            <label className="field">
              Название шаблона
              <input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Например: Песок — город"
              />
            </label>
          ) : null}
        </section>

        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Создание…' : 'Создать заказ'}
        </button>
      </form>
    </section>
  );
}
