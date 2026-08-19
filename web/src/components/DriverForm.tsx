import { useForm, type FieldErrors, type UseFormRegister } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  buildDriverCreatePayload,
  buildDriverUpdatePayload,
  defaultDriverCreateValues,
  driverCreateSchema,
  driverEditSchema,
  driverToEditValues,
  type DriverCreateFormValues,
  type DriverEditFormValues,
} from '../schemas/driverSchema';
import type { Driver } from '../types';

function DriverFormFields({
  register,
  errors,
  isEdit,
}: {
  register: UseFormRegister<DriverCreateFormValues>;
  errors: FieldErrors<DriverCreateFormValues>;
  isEdit: boolean;
}) {
  return (
    <>
      <section className="card form-section">
        <h3>Основные данные</h3>
        <label className="field">
          <span>ФИО *</span>
          <input {...register('full_name')} autoComplete="name" />
          {errors.full_name?.message ? <span className="field-error">{errors.full_name.message}</span> : null}
        </label>
        <label className="field">
          <span>Email *</span>
          <input {...register('email')} autoComplete="username" />
          {errors.email?.message ? <span className="field-error">{errors.email.message}</span> : null}
        </label>
        {!isEdit ? (
          <label className="field">
            <span>Пароль *</span>
            <input type="password" {...register('password')} autoComplete="new-password" />
            {errors.password?.message ? <span className="field-error">{errors.password.message}</span> : null}
          </label>
        ) : (
          <label className="field">
            <span>Новый пароль</span>
            <input
              type="password"
              {...register('password')}
              autoComplete="new-password"
              placeholder="Оставьте пустым, если не меняете"
            />
          </label>
        )}
        <label className="field">
          <span>Телефон</span>
          <input {...register('phone')} autoComplete="tel" placeholder="+7 900 000-00-00" />
          {errors.phone?.message ? <span className="field-error">{errors.phone.message}</span> : null}
        </label>
        <label className="field">
          <span>Госномер</span>
          <input {...register('car_number')} autoCapitalize="characters" />
        </label>
      </section>

      <section className="card form-section">
        <h3>Водительское удостоверение</h3>
        <label className="field">
          <span>Номер ВУ</span>
          <input {...register('license_number')} />
        </label>
        <label className="field">
          <span>Срок действия ВУ</span>
          <input type="date" {...register('license_expiry')} />
        </label>
        <label className="field">
          <span>Медосмотр до</span>
          <input type="date" {...register('medical_check_expiry')} />
        </label>
      </section>

      <section className="card form-section">
        <h3>Ставки и статус</h3>
        <label className="field">
          <span>Надбавка «старший» за вахту, ₽</span>
          <input
            type="number"
            min={0}
            step="1"
            {...register('senior_shift_bonus', {
              setValueAs: (value) => {
                if (value === '' || value == null) return undefined;
                const parsed = Number(value);
                return Number.isFinite(parsed) ? parsed : undefined;
              },
            })}
          />
          {errors.senior_shift_bonus?.message ? (
            <span className="field-error">{String(errors.senior_shift_bonus.message)}</span>
          ) : null}
        </label>
        <label className="checkbox-row">
          <input type="checkbox" {...register('is_active')} />
          Активен (может входить в приложение)
        </label>
      </section>
    </>
  );
}

interface DriverCreateFormProps {
  submitting?: boolean;
  onSubmit: (payload: ReturnType<typeof buildDriverCreatePayload>) => void | Promise<void>;
  onCancel: () => void;
}

export function DriverCreateForm({ submitting = false, onSubmit, onCancel }: DriverCreateFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DriverCreateFormValues>({
    resolver: zodResolver(driverCreateSchema),
    defaultValues: defaultDriverCreateValues,
  });

  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        await onSubmit(buildDriverCreatePayload(values));
      })}
      className="form-stack"
    >
      <DriverFormFields register={register} errors={errors} isEdit={false} />
      <div className="action-row">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Сохранение…' : 'Создать водителя'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
          Отмена
        </button>
      </div>
    </form>
  );
}

interface DriverEditFormProps {
  driver: Driver;
  submitting?: boolean;
  onSubmit: (payload: ReturnType<typeof buildDriverUpdatePayload>) => void | Promise<void>;
  onCancel: () => void;
}

export function DriverEditForm({ driver, submitting = false, onSubmit, onCancel }: DriverEditFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DriverEditFormValues>({
    resolver: zodResolver(driverEditSchema),
    defaultValues: driverToEditValues(driver),
  });

  const sharedRegister = register as unknown as UseFormRegister<DriverCreateFormValues>;
  const sharedErrors = errors as FieldErrors<DriverCreateFormValues>;

  return (
    <form
      onSubmit={handleSubmit(async (values) => {
        await onSubmit(buildDriverUpdatePayload(values));
      })}
      className="form-stack"
    >
      <DriverFormFields register={sharedRegister} errors={sharedErrors} isEdit />
      {'password' in errors && errors.password?.message ? (
        <p className="field-error">{errors.password.message}</p>
      ) : null}
      <div className="action-row">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Сохранение…' : 'Сохранить изменения'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>
          Отмена
        </button>
      </div>
    </form>
  );
}
