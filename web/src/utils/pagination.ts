export const DEFAULT_PAGE_SIZE = 20;

export function paginateItems<T>(items: T[], page: number, pageSize = DEFAULT_PAGE_SIZE): T[] {
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export function totalPages(count: number, pageSize = DEFAULT_PAGE_SIZE): number {
  if (count <= 0) return 1;
  return Math.ceil(count / pageSize);
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(value);
}
