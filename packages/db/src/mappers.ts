/** Row <-> domain conversions for assets and watchlist. No financial calculation (R1); integers only (R2). */
import { EXCHANGES, RowMappingError, toSafeInt } from '@stoktok/core';
import type { Exchange, PriceQuote, SectorInfo, SignalLabel, SignalStatus, StoredClose, StoredSignal } from '@stoktok/core';
import type { AssetRow, FinancialRow, OpenGapRow, PriceCloseRow, PriceDailyRow, SignalRow, SymbolSectorRow, TradeDateRow, WatchlistRow } from './rows';

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

/** null = unknown exchange. A stored value outside EXCHANGES is a mapping error, never coerced. */
export function symbolExchangeFromRow(row: { symbol: string; exchange: string | null }): Exchange | null {
  if (row.exchange === null) return null;
  const found = EXCHANGES.find((e) => e === row.exchange);
  if (!found) throw new RowMappingError('symbols', 'exchange', `invalid exchange: ${String(row.exchange)}`);
  return found;
}

export function storedCloseFromRow(row: PriceCloseRow): StoredClose {
  const volume = toSafeInt(row.volume, 'volume', 'prices_daily');
  if (volume < 0) throw new RowMappingError('prices_daily', 'volume', `negative volume: ${volume}`);
  return { ...priceQuoteFromRow(row), volume };
}

export interface FinancialRecord {
  symbol: string;
  /** 'YYYYQn'. */
  period: string;
  /** Integer VND per share, as published (basis UNVERIFIED, see docs/adr/0002). */
  eps: number;
  bvps: number;
  /** Integer VND. */
  revenue: number;
  netIncome: number;
  source: string;
  fetchedAt: string;
}

const PERIOD_RE = /^\d{4}Q[1-4]$/;

/** R4: a row without source or fetched_at is rejected. */
export function financialFromRow(row: FinancialRow): FinancialRecord {
  const t = 'financials';
  if (typeof row.period !== 'string' || !PERIOD_RE.test(row.period)) {
    throw new RowMappingError(t, 'period', `invalid period: ${String(row.period)}`);
  }
  if (typeof row.source !== 'string' || row.source === '') throw new RowMappingError(t, 'source', 'missing source');
  if (typeof row.fetched_at !== 'string' || row.fetched_at === '') {
    throw new RowMappingError(t, 'fetched_at', 'missing fetched_at');
  }
  return {
    symbol: row.symbol,
    period: row.period,
    eps: toSafeInt(row.eps, 'eps', t),
    bvps: toSafeInt(row.bvps, 'bvps', t),
    revenue: toSafeInt(row.revenue, 'revenue', t),
    netIncome: toSafeInt(row.net_income, 'net_income', t),
    source: row.source,
    fetchedAt: row.fetched_at,
  };
}

export interface OpenGapRecord {
  id: number;
  symbol: string | null;
  fromTs: string;
  toTs: string;
}

export function openGapFromRow(row: OpenGapRow): OpenGapRecord {
  return { id: toSafeInt(row.id, 'id', 'data_gaps'), symbol: row.symbol, fromTs: row.from_ts, toTs: row.to_ts };
}

export function tradeDateFromRow(row: TradeDateRow): string {
  if (typeof row.trade_date !== 'string' || !DATE_RE.test(row.trade_date)) {
    throw new RowMappingError('prices_daily', 'trade_date', `invalid date: ${String(row.trade_date)}`);
  }
  return row.trade_date;
}

/** R4: a sector without source or fetched_at is rejected; no sector means unknown. */
export function symbolSectorFromRow(row: SymbolSectorRow): SectorInfo {
  if (row.sector === null) return { sector: null, source: null, fetchedAt: null };
  const t = 'symbols';
  if (typeof row.sector_source !== 'string' || row.sector_source === '') throw new RowMappingError(t, 'sector_source', 'missing sector source');
  if (typeof row.sector_fetched_at !== 'string' || row.sector_fetched_at === '') {
    throw new RowMappingError(t, 'sector_fetched_at', 'missing sector fetched_at');
  }
  return { sector: row.sector, source: row.sector_source, fetchedAt: row.sector_fetched_at };
}

const SIGNAL_LABELS: readonly string[] = ['bullish', 'bearish', 'neutral'];

/**
 * Strict on what the table checks guarantee (status, label, date, integers: R2). Lenient on `reason_codes`
 * (unknown codes are kept) and `inputs_snapshot` (passed through): core parses and labels them.
 */
export function signalFromRow(row: SignalRow): StoredSignal {
  const t = 'signals';
  if (row.status !== 'ok' && row.status !== 'suppressed') throw new RowMappingError(t, 'status', `invalid status: ${String(row.status)}`);
  if (row.label !== null && !SIGNAL_LABELS.includes(row.label)) throw new RowMappingError(t, 'label', `invalid label: ${String(row.label)}`);
  if (typeof row.signal_date !== 'string' || !DATE_RE.test(row.signal_date)) {
    throw new RowMappingError(t, 'signal_date', `invalid date: ${String(row.signal_date)}`);
  }
  return {
    symbol: row.symbol,
    ruleId: row.rule_id,
    signalDate: row.signal_date,
    status: row.status as SignalStatus,
    label: row.label as SignalLabel | null,
    value: row.value === null ? null : toSafeInt(row.value, 'value', t),
    reasonCodes: Array.isArray(row.reason_codes) ? row.reason_codes.filter((c): c is string => typeof c === 'string') : [],
    inputs: row.inputs_snapshot,
    ruleVersion: toSafeInt(row.rule_version, 'rule_version', t),
    computedAt: row.computed_at,
  };
}
