import { z } from 'zod';

const optionalText = z.string().trim().optional().or(z.literal(''));

const phoneSchema = optionalText.refine(
  (value) => !value || value.replace(/\D/g, '').length >= 10,
  'Телефон: минимум 10 цифр'
);

const bonusSchema = z.number().min(0, 'Надбавка должна быть ≥ 0').optional();

export const driverCreateSchema = z.object({
  full_name: z.string().trim().min(2, 'ФИО — минимум 2 символа'),
  email: z.string().trim().email('Укажите корректный email'),
  password: z.string().min(6, 'Пароль — минимум 6 символов'),
  phone: phoneSchema,
  car_number: optionalText,
  license_number: optionalText,
  license_expiry: optionalText,
  medical_check_expiry: optionalText,
  senior_shift_bonus: bonusSchema,
  is_active: z.boolean(),
});

export const driverEditSchema = driverCreateSchema
  .omit({ password: true })
  .extend({
    password: z
      .string()
      .optional()
      .refine((value) => !value || value.length >= 6, 'Новый пароль — минимум 6 символов'),
  });

export type DriverCreateFormValues = z.infer<typeof driverCreateSchema>;
export type DriverEditFormValues = z.infer<typeof driverEditSchema>;

export const defaultDriverCreateValues: DriverCreateFormValues = {
  full_name: '',
  email: '',
  password: '',
  phone: '',
  car_number: '',
  license_number: '',
  license_expiry: '',
  medical_check_expiry: '',
  senior_shift_bonus: undefined,
  is_active: true,
};

export function driverToEditValues(driver: {
  full_name: string | null;
  email: string;
  phone: string | null;
  car_number: string | null;
  license_number: string | null;
  license_expiry: string | null;
  medical_check_expiry: string | null;
  senior_shift_bonus?: number;
  is_active: number;
}): DriverEditFormValues {
  return {
    full_name: driver.full_name ?? '',
    email: driver.email,
    password: '',
    phone: driver.phone ?? '',
    car_number: driver.car_number ?? '',
    license_number: driver.license_number ?? '',
    license_expiry: driver.license_expiry ?? '',
    medical_check_expiry: driver.medical_check_expiry ?? '',
    senior_shift_bonus: driver.senior_shift_bonus ?? undefined,
    is_active: Boolean(driver.is_active),
  };
}

export function buildDriverCreatePayload(values: DriverCreateFormValues) {
  return {
    full_name: values.full_name.trim(),
    email: values.email.trim().toLowerCase(),
    password: values.password,
    phone: values.phone?.trim() || undefined,
    car_number: values.car_number?.trim() || undefined,
    license_number: values.license_number?.trim() || undefined,
    license_expiry: values.license_expiry?.trim() || undefined,
    medical_check_expiry: values.medical_check_expiry?.trim() || undefined,
    senior_shift_bonus: values.senior_shift_bonus,
    is_active: values.is_active,
  };
}

export function buildDriverUpdatePayload(values: DriverEditFormValues) {
  return {
    full_name: values.full_name.trim(),
    email: values.email.trim().toLowerCase(),
    password: values.password?.trim() || undefined,
    phone: values.phone?.trim() || null,
    car_number: values.car_number?.trim() || null,
    license_number: values.license_number?.trim() || null,
    license_expiry: values.license_expiry?.trim() || null,
    medical_check_expiry: values.medical_check_expiry?.trim() || null,
    senior_shift_bonus: values.senior_shift_bonus ?? null,
    is_active: values.is_active,
  };
}
