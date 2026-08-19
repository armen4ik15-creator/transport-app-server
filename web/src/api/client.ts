import axios, { AxiosError } from 'axios';

export const TOKEN_KEY = 'reestrpro.token';

const DEFAULT_API_URL =
  import.meta.env.VITE_API_URL ??
  'https://armen4ik15-creator-transport-app-server-26b3.twc1.net/api';

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export const api = axios.create({
  baseURL: DEFAULT_API_URL,
  timeout: 20000,
});

api.interceptors.request.use((config) => {
  const token = readToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export function getApiHost(): string {
  const base = DEFAULT_API_URL.replace(/\/api\/?$/, '');
  return base;
}

export function resolveUploadUrl(filePath: string): string {
  if (!filePath) return '';
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath;
  const host = getApiHost();
  return `${host}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
}

export function apiErrorMessage(err: unknown, fallback = 'Ошибка'): string {
  if (axios.isAxiosError(err)) {
    const axErr = err as AxiosError<{ error?: string }>;
    if (axErr.response?.data?.error) return axErr.response.data.error;
    if (axErr.code === 'ECONNABORTED') return 'Превышено время ожидания сервера';
    if (axErr.message === 'Network Error' || axErr.message === 'Failed to fetch') {
      return 'Нет связи с API. Проверьте интернет и что backend доступен.';
    }
    if (axErr.response?.status === 502) {
      return 'Сервер временно недоступен (502). Подождите минуту и повторите.';
    }
    if (axErr.response?.status === 503) {
      return 'База данных временно недоступна. Попробуйте через минуту.';
    }
    return axErr.message;
  }
  if (err instanceof Error) {
    if (err.message === 'Failed to fetch') {
      return 'Нет связи с API. Проверьте интернет и что backend доступен.';
    }
    return err.message;
  }
  return fallback;
}
