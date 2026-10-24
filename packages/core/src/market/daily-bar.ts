import { isValidDate } from '../calendar';
import type { PriceSanity } from './config';

export type PriceUnit = 'VND' | 'THOUSAND_VND';

/** A bar as a source returned it: nothing is trusted yet. */
export interface RawDailyBar {
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
  tradeDate: unknown;
}

/** Integer VND prices (R2). */
export interface DailyBar {
  symbol: string;
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  foreignNet: number | null;
}

export type NormalizeResult = { ok: true; bar: DailyBar } | { ok: false; reason: string };

/** The only price conversion: returns integer VND or null when the value is not a whole number of VND. */
export function toVnd(value: unknown, unit: PriceUnit): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (unit === 'VND') return Number.isSafeInteger(value) ? value : null;
  const n = value * 1000;
  const r = Math.round(n);
  if (Math.abs(n - r) > 1e-6 || !Number.isSafeInteger(r)) return null;
  return r;
}

/** Validates and converts one bar. Never throws; a failure returns a reason code. */
export function normalizeDailyBar(
  symbol: string,
  raw: RawDailyBar,
  unit: PriceUnit,
  sanity: PriceSanity,
  lastClose?: number,
): NormalizeResult {
  if (!isValidDate(raw.tradeDate)) return { ok: false, reason: 'invalid_trade_date' };
  const prices: Record<'open' | 'high' | 'low' | 'close', number> = { open: 0, high: 0, low: 0, close: 0 };
  for (const field of ['open', 'high', 'low', 'close'] as const) {
    const raw_ = raw[field];
    if (raw_ === undefined || raw_ === null) return { ok: false, reason: `missing_${field}` };
    const v = toVnd(raw_, unit);
    if (v === null) return { ok: false, reason: `invalid_${field}` };
    prices[field] = v;
  }
  const volume = raw.volume;
  if (volume === undefined || volume === null) return { ok: false, reason: 'missing_volume' };
  if (typeof volume !== 'number' || !Number.isSafeInteger(volume) || volume < 0) return { ok: false, reason: 'invalid_volume' };

  const { open, high, low, close } = prices;
  if (low > high) return { ok: false, reason: 'low_above_high' };
  if (open < low || open > high) return { ok: false, reason: 'open_outside_range' };
  if (close < low || close > high) return { ok: false, reason: 'close_outside_range' };
  for (const p of [open, high, low, close]) {
    if (p < sanity.minPriceVnd || p > sanity.maxPriceVnd) return { ok: false, reason: 'price_out_of_band' };
    if (p % sanity.priceStepVnd !== 0) return { ok: false, reason: 'price_off_step' };
  }
  if (lastClose !== undefined && lastClose > 0) {
    if (Math.max(close / lastClose, lastClose / close) > sanity.maxCloseJumpRatio) return { ok: false, reason: 'close_jump' };
  }
  return { ok: true, bar: { symbol, tradeDate: raw.tradeDate, open, high, low, close, volume, foreignNet: null } };
}
