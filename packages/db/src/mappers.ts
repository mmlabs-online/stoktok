/** Row <-> domain conversions for assets and watchlist. No financial calculation (R1); integers only (R2). */
import { RowMappingError, toSafeInt } from '@stoktok/core';
import type { PriceQuote } from '@stoktok/core';
import type { AssetRow, PriceDailyRow, WatchlistRow } from './rows';

export interface Asset {
  id: string;
  type: 'cash' | 'other';
  name: string;
  /** Integer VND. */
  value: number;
  /** 'YYYY-MM-DD'. */
  asOf: string;
}

export interface WatchlistEntry {
  symbol: string;
  group: string;
  addedAt: string;
}

// core does not export isValidDate; a local format check avoids a core change (STK-006 plan).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assetFromRow(row: AssetRow): Asset {
  const t = 'assets';
  if (row.type !== 'cash' && row.type !== 'other') throw new RowMappingError(t, 'type', `invalid type: ${row.type}`);
  if (typeof row.as_of !== 'string' || !DATE_RE.test(row.as_of)) {
    throw new RowMappingError(t, 'as_of', `invalid date: ${String(row.as_of)}`);
  }
  return { id: row.id, type: row.type, name: row.name, value: toSafeInt(row.value, 'value', t), asOf: row.as_of };
}

export function assetToRow(asset: Omit<Asset, 'id'>): Omit<AssetRow, 'id'> {
  return { type: asset.type, name: asset.name, value: asset.value, as_of: asset.asOf };
}

export function watchlistFromRow(row: WatchlistRow): WatchlistEntry {
  return { symbol: row.symbol, group: row.group_name, addedAt: row.added_at };
}

/** R4: a quote without source or fetched_at is rejected, never shown as current. */
export function priceQuoteFromRow(row: PriceDailyRow): PriceQuote {
  const t = 'prices_daily';
  if (typeof row.trade_date !== 'string' || !DATE_RE.test(row.trade_date)) {
    throw new RowMappingError(t, 'trade_date', `invalid date: ${String(row.trade_date)}`);
  }
  const close = toSafeInt(row.close, 'close', t);
  if (close < 0) throw new RowMappingError(t, 'close', `negative close: ${close}`);
  if (typeof row.source !== 'string' || row.source === '') throw new RowMappingError(t, 'source', 'missing source');
  if (typeof row.fetched_at !== 'string' || row.fetched_at === '') {
    throw new RowMappingError(t, 'fetched_at', 'missing fetched_at');
  }
  return { symbol: row.symbol, close, tradeDate: row.trade_date, source: row.source, fetchedAt: row.fetched_at };
}
