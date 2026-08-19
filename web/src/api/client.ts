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

export function getApiBaseUrl(): string {
  return DEFAULT_API_URL;
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

export function logApiError(context: string, err: unknown): void {
  if (!axios.isAxiosError(err)) {
    console.error(`[${context}]`, err);
    return;
  }
  const axErr = err as AxiosError<{ error?: string }>;
  const requestUrl = axErr.config?.baseURL
    ? `${axErr.config.baseURL}${axErr.config.url ?? ''}`
    : axErr.config?.url;
  console.error(`[${context}]`, {
    url: requestUrl,
    status: axErr.response?.status ?? null,
    code: axErr.code ?? null,
    message: axErr.message,
    serverError: axErr.response?.data?.error ?? null,
  });
}

export function apiErrorMessage(err: unknown, fallback = 'Ошибка'): string {
  if (axios.isAxiosError(err)) {
    const axErr = err as AxiosError<{ error?: string }>;
    const status = axErr.response?.status;
    const serverError = axErr.response?.data?.error;

    if (serverError) return serverError;

    if (status === 401) return 'Неверный email или пароль';
    if (status === 403) return 'Доступ запрещён';
    if (status === 404) return 'Эндпоинт не найден на сервере';
    if (status === 500) return 'Ошибка сервера. Попробуйте через минуту.';
    if (status === 502) {
      return 'Сервер временно недоступен (502). Подождите минуту и повторите.';
    }
    if (status === 503) {
      return 'База данных временно недоступна. Попробуйте через минуту.';
    }

    if (axErr.code === 'ECONNABORTED') {
      return 'Превышено время ожидания сервера. Проверьте интернет и повторите.';
    }

    if (!axErr.response) {
      if (axErr.message === 'Network Error' || axErr.message === 'Failed to fetch') {
        return 'Не удалось связаться с сервером. Проверьте интернет, VPN и блокировщик рекламы.';
      }
      return 'Сервер не ответил. Проверьте доступность API в браузере.';
    }

    return axErr.message || fallback;
  }

  if (err instanceof Error) {
    if (err.message === 'Failed to fetch') {
      return 'Не удалось связаться с сервером. Проверьте интернет, VPN и блокировщик рекламы.';
    }
    return err.message;
  }

  return fallback;
}

export async function checkApiHealth(): Promise<{ ok: boolean; message: string }> {
  const healthUrl = `${getApiHost()}/api/health`;
  try {
    const response = await fetch(healthUrl, { method: 'GET', cache: 'no-store' });
    if (!response.ok) {
      return { ok: false, message: `API health: HTTP ${response.status}` };
    }
    return { ok: true, message: 'API доступен' };
  } catch {
    return { ok: false, message: 'API недоступен из браузера' };
  }
}
