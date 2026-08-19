import type { Contractor, Driver, Material, OrderTemplate } from '../types';
import { parseDecimalInput } from '../utils/numbers';

export interface OrderFormState {
  driverId: number | null;
  contractorId: number | null;
  taskName: string;
  sender: string;
  receiver: string;
  plannedVolume: string;
  material: string;
  quantity: string;
  unit: string;
  driverRate: string;
  companyRate: string;
  distanceKm: string;
  description: string;
  notes: string;
  loadAddress: string;
  unloadAddress: string;
  amount: string;
  isActive: boolean;
}

export const defaultOrderFormState: OrderFormState = {
  driverId: null,
  contractorId: null,
  taskName: '',
  sender: '',
  receiver: '',
  plannedVolume: '',
  material: '',
  quantity: '',
  unit: 'м3',
  driverRate: '',
  companyRate: '',
  distanceKm: '',
  description: '',
  notes: '',
  loadAddress: '',
  unloadAddress: '',
  amount: '',
  isActive: true,
};

interface OrderFormFieldsProps {
  form: OrderFormState;
  onChange: (patch: Partial<OrderFormState>) => void;
  drivers: Driver[];
  contractors: Contractor[];
  materials: Material[];
  showDriver?: boolean;
  showAmount?: boolean;
  showActiveToggle?: boolean;
  createForAllDrivers?: boolean;
  onToggleAllDrivers?: () => void;
}

export function OrderFormFields({
  form,
  onChange,
  drivers,
  contractors,
  materials,
  showDriver = true,
  showAmount = false,
  showActiveToggle = false,
  createForAllDrivers = false,
  onToggleAllDrivers,
}: OrderFormFieldsProps) {
  return (
    <div className="form-grid">
      {showDriver ? (
        <section className="card form-section">
          <h3>Водитель</h3>
          {onToggleAllDrivers ? (
            <button
              type="button"
              className={createForAllDrivers ? 'chip active' : 'chip'}
              onClick={onToggleAllDrivers}
            >
              {createForAllDrivers ? '✓ Назначить всем водителям' : 'Назначить всем водителям'}
            </button>
          ) : null}
          {!createForAllDrivers ? (
            drivers.length === 0 ? (
              <p className="muted">Нет водителей</p>
            ) : (
              <div className="choice-list">
                {drivers.map((driver) => (
                  <button
                    key={driver.id}
                    type="button"
                    className={form.driverId === driver.id ? 'chip active' : 'chip'}
                    onClick={() => onChange({ driverId: driver.id })}
                  >
                    {driver.full_name ?? driver.email}
                    {driver.car_number ? ` (${driver.car_number})` : ''}
                  </button>
                ))}
              </div>
            )
          ) : null}
        </section>
      ) : null}

      <section className="card form-section">
        <h3>Контрагент</h3>
        {contractors.length === 0 ? (
          <p className="muted">Нет контрагентов</p>
        ) : (
          <div className="choice-list">
            {contractors.map((contractor) => (
              <button
                key={contractor.id}
                type="button"
                className={form.contractorId === contractor.id ? 'chip active' : 'chip'}
                onClick={() => onChange({ contractorId: contractor.id })}
              >
                {contractor.name}
              </button>
            ))}
          </div>
        )}
      </section>

      <label className="field">
        Описание
        <input value={form.description} onChange={(e) => onChange({ description: e.target.value })} />
      </label>
      <label className="field">
        Название задачи
        <input value={form.taskName} onChange={(e) => onChange({ taskName: e.target.value })} />
      </label>
      <label className="field">
        Отправитель
        <input value={form.sender} onChange={(e) => onChange({ sender: e.target.value })} />
      </label>
      <label className="field">
        Получатель
        <input value={form.receiver} onChange={(e) => onChange({ receiver: e.target.value })} />
      </label>
      <label className="field">
        Адрес погрузки
        <input value={form.loadAddress} onChange={(e) => onChange({ loadAddress: e.target.value })} />
      </label>
      <label className="field">
        Адрес разгрузки
        <input value={form.unloadAddress} onChange={(e) => onChange({ unloadAddress: e.target.value })} />
      </label>
      <label className="field">
        Материал
        <input value={form.material} onChange={(e) => onChange({ material: e.target.value })} />
      </label>

      {materials.length > 0 ? (
        <section className="card form-section">
          <h3>Справочник материалов</h3>
          <div className="choice-list">
            {materials.slice(0, 12).map((item) => (
              <button
                key={item.id}
                type="button"
                className={form.material === item.name ? 'chip active' : 'chip'}
                onClick={() => onChange({ material: item.name, unit: item.unit })}
              >
                {item.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <label className="field">
        Количество
        <input
          value={form.quantity}
          onChange={(e) => onChange({ quantity: e.target.value })}
          inputMode="decimal"
        />
      </label>
      <label className="field">
        Плановый объём
        <input
          value={form.plannedVolume}
          onChange={(e) => onChange({ plannedVolume: e.target.value })}
          inputMode="decimal"
        />
      </label>
      <label className="field">
        Ед. измерения
        <input value={form.unit} onChange={(e) => onChange({ unit: e.target.value })} placeholder="м3 / т / рейс" />
      </label>
      <label className="field">
        Ставка водителя
        <input
          value={form.driverRate}
          onChange={(e) => onChange({ driverRate: e.target.value })}
          inputMode="decimal"
        />
      </label>
      <label className="field">
        Ставка компании
        <input
          value={form.companyRate}
          onChange={(e) => onChange({ companyRate: e.target.value })}
          inputMode="decimal"
        />
      </label>
      <label className="field">
        Плечо, км
        <input
          value={form.distanceKm}
          onChange={(e) => onChange({ distanceKm: e.target.value })}
          inputMode="decimal"
        />
      </label>
      <label className="field">
        Примечание
        <input value={form.notes} onChange={(e) => onChange({ notes: e.target.value })} />
      </label>

      {showAmount ? (
        <label className="field">
          Сумма заказа
          <input value={form.amount} onChange={(e) => onChange({ amount: e.target.value })} inputMode="decimal" />
        </label>
      ) : null}

      {showActiveToggle ? (
        <section className="card form-section">
          <h3>Активность</h3>
          <div className="choice-list">
            <button
              type="button"
              className={form.isActive ? 'chip active' : 'chip'}
              onClick={() => onChange({ isActive: true })}
            >
              Активный заказ
            </button>
            <button
              type="button"
              className={!form.isActive ? 'chip active' : 'chip'}
              onClick={() => onChange({ isActive: false })}
            >
              В архиве (неактивен)
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function applyTemplateToForm(template: OrderTemplate): Partial<OrderFormState> {
  return {
    contractorId: template.contractor_id,
    material: template.material ?? '',
    unit: template.unit ?? 'м3',
    quantity: template.default_quantity != null ? String(template.default_quantity) : '',
    driverRate: template.driver_rate != null ? String(template.driver_rate) : '',
    companyRate: template.company_rate != null ? String(template.company_rate) : '',
    distanceKm: template.distance_km != null ? String(template.distance_km) : '',
    notes: template.notes ?? '',
    description: template.description ?? '',
    loadAddress: template.load_address ?? '',
    unloadAddress: template.unload_address ?? '',
  };
}

export function buildOrderPayload(form: OrderFormState) {
  return {
    contractor_id: form.contractorId as number,
    task_name: form.taskName.trim() || undefined,
    sender: form.sender.trim() || undefined,
    receiver: form.receiver.trim() || undefined,
    total_planned_volume: parseDecimalInput(form.plannedVolume),
    material: form.material.trim() || undefined,
    quantity: parseDecimalInput(form.quantity),
    unit: form.unit.trim() || undefined,
    driver_rate: parseDecimalInput(form.driverRate),
    company_rate: parseDecimalInput(form.companyRate),
    distance_km: parseDecimalInput(form.distanceKm),
    notes: form.notes.trim() || undefined,
    description: form.description.trim() || undefined,
    load_address: form.loadAddress.trim() || undefined,
    unload_address: form.unloadAddress.trim() || undefined,
    amount: parseDecimalInput(form.amount),
    is_active: form.isActive,
  };
}
