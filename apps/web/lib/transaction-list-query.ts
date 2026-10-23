import { isValidDate, normalizeSymbol } from '@stoktok/core';

export const PAGE_SIZE = 20;

export interface TransactionListQuery {
  symbol?: string;
  side?: 'buy' | 'sell';
  from?: string;
  to?: string;
  page: number;
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? '';
}

/** Whitelists and normalises the URL query. Invalid filters are dropped (symbol is reported). */
export function parseTransactionListQuery(sp: SearchParams): { query: TransactionListQuery; notices: string[] } {
  const notices: string[] = [];
  const query: TransactionListQuery = { page: 1 };

  const rawSymbol = first(sp.symbol);
  if (rawSymbol !== '') {
    const symbol = normalizeSymbol(rawSymbol);
    if (symbol) query.symbol = symbol;
    else notices.push('Mã không hợp lệ, đã bỏ qua bộ lọc mã.');
  }

  const side = first(sp.side);
  if (side === 'buy' || side === 'sell') query.side = side;

  const from = first(sp.from);
  const to = first(sp.to);
  if (isValidDate(from)) query.from = from;
  if (isValidDate(to)) query.to = to;
  if (query.from && query.to && query.from > query.to) [query.from, query.to] = [query.to, query.from];

  const page = first(sp.page);
  if (/^\d{1,6}$/.test(page) && Number(page) >= 1) query.page = Number(page);

  return { query, notices };
}

export function pageMeta(total: number, page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return {
    page,
    pageCount,
    offset: (page - 1) * pageSize,
    prevPage: Math.max(1, page - 1),
    nextPage: Math.min(pageCount, page + 1),
    hasPrev: page > 1,
    hasNext: page < pageCount,
  };
}

/** Link to the list with the current filters and some fields overridden (undefined removes one). */
export function listHref(query: TransactionListQuery, overrides: Partial<TransactionListQuery> = {}): string {
  const q = { ...query, ...overrides };
  const params = new URLSearchParams();
  if (q.symbol) params.set('symbol', q.symbol);
  if (q.side) params.set('side', q.side);
  if (q.from) params.set('from', q.from);
  if (q.to) params.set('to', q.to);
  if (q.page > 1) params.set('page', String(q.page));
  const s = params.toString();
  return s ? `/transactions?${s}` : '/transactions';
}
