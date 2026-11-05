import { isTradingDay, vnDateOf, vnMinutesOf } from '../calendar';
import type { PriceSanity } from './config';
import { toVnd } from './daily-bar';
import type { PriceUnit } from './daily-bar';

/** A half-open session window [from, to) in minutes after midnight, Vietnam time. */
export interface SessionWindow {
  fromMinutesVn: number;
  toMinutesVn: number;
}

export interface IntradayConfig {
  /** Ascending, non-overlapping windows. */
  sessions: readonly SessionWindow[];
  /** Minutes the last window is extended to catch the final ATC print. */
  postCloseGraceMinutes: number;
  /** Minimum time between source calls for one symbol (used by the web refresh, STK-049 slice 2). */
  throttleMs: number;
  /** Client refresh period while the app is open (slice 3). */
  refreshIntervalMs: number;
  /** A stored quote older than this counts as delayed (slice 2/3). */
  staleAfterMs: number;
}

/**
 * One union window for HOSE/HNX/UPCoM (09:00-11:30, 13:00-15:00; covers HOSE ATC 14:30-14:45 and the HNX/UPCoM close
 * at 15:00) plus a grace period for the last ATC print (R5: market config).
 * UNVERIFIED, verify before go-live.
 */
export const DEFAULT_INTRADAY_CONFIG: IntradayConfig = {
  sessions: [
    { fromMinutesVn: 9 * 60, toMinutesVn: 11 * 60 + 30 },
    { fromMinutesVn: 13 * 60, toMinutesVn: 15 * 60 },
  ],
  postCloseGraceMinutes: 3,
  throttleMs: 30_000,
  refreshIntervalMs: 30_000,
  staleAfterMs: 90_000,
};

/** Throws RangeError on a config that cannot describe sessions. */
export function validateIntradayConfig(c: IntradayConfig): void {
  if (c.sessions.length === 0) throw new RangeError('sessions must not be empty');
  let prevTo = 0;
  for (const w of c.sessions) {
    const ok = Number.isInteger(w.fromMinutesVn) && Number.isInteger(w.toMinutesVn);
    if (!ok || w.fromMinutesVn < 0 || w.toMinutesVn > 1440 || w.fromMinutesVn >= w.toMinutesVn) {
      throw new RangeError('invalid session window');
    }
    if (w.fromMinutesVn < prevTo) throw new RangeError('session windows must be sorted and not overlap');
    prevTo = w.toMinutesVn;
  }
  if (!Number.isInteger(c.postCloseGraceMinutes) || c.postCloseGraceMinutes < 0) {
    throw new RangeError('postCloseGraceMinutes must be a non-negative integer');
  }
  for (const k of ['throttleMs', 'refreshIntervalMs', 'staleAfterMs'] as const) {
    if (!Number.isFinite(c[k]) || c[k] <= 0) throw new RangeError(`${k} must be positive`);
  }
}

/** True on a trading day inside a session window (the last one extended by the grace). Holidays are an input (R5). */
export function isInIntradayWindow(now: Date, holidays: readonly string[], config: IntradayConfig = DEFAULT_INTRADAY_CONFIG): boolean {
  validateIntradayConfig(config);
  if (!isTradingDay(vnDateOf(now), holidays)) return false;
  const m = vnMinutesOf(now);
  const last = config.sessions.length - 1;
  return config.sessions.some((w, i) => m >= w.fromMinutesVn && m < w.toMinutesVn + (i === last ? config.postCloseGraceMinutes : 0));
}

/** Integer VND (R2). `ts` is the source's minute-bar time (ISO), `fetchedAt` is our clock (R4). */
export interface IntradayQuote {
  symbol: string;
  ts: string;
  price: number;
  /** Session-cumulative volume for the VN day. */
  volume: number;
  source: string;
  fetchedAt: string;
}

/** A minute bar as a source returned it: nothing is trusted yet. `t` is epoch seconds. */
export interface RawMinuteBar {
  t: unknown;
  c: unknown;
  v: unknown;
}

export type IntradayQuoteResult = { ok: true; quote: IntradayQuote } | { ok: false; reason: string };

export interface IntradayQuoteInput {
  /** 'YYYY-MM-DD' (VN) the quote must belong to. */
  today: string;
  unit: PriceUnit;
  sanity: PriceSanity;
  lastClose?: number;
  source: string;
  fetchedAt: string;
}

/**
 * Reduces minute bars to one quote: the newest bar of `today` gives ts and price, the sum of today's volumes gives the
 * session volume. Same price guards and reason names as normalizeDailyBar. Never throws on data.
 */
export function intradayQuoteFromMinuteBars(symbol: string, bars: readonly RawMinuteBar[], i: IntradayQuoteInput): IntradayQuoteResult {
  let newest: RawMinuteBar | undefined;
  let newestT = -1;
  const todays: RawMinuteBar[] = [];
  for (const b of bars) {
    if (typeof b.t !== 'number' || !Number.isSafeInteger(b.t) || b.t < 0) return { ok: false, reason: 'invalid_ts' };
    if (vnDateOf(new Date(b.t * 1000)) !== i.today) continue;
    todays.push(b);
    if (b.t > newestT) {
      newestT = b.t;
      newest = b;
    }
  }
  if (newest === undefined) return { ok: false, reason: 'no_bars_today' };

  if (newest.c === undefined || newest.c === null) return { ok: false, reason: 'invalid_price' };
  const price = toVnd(newest.c, i.unit);
  if (price === null) return { ok: false, reason: 'invalid_price' };
  if (price < i.sanity.minPriceVnd || price > i.sanity.maxPriceVnd) return { ok: false, reason: 'price_out_of_band' };
  if (price % i.sanity.priceStepVnd !== 0) return { ok: false, reason: 'price_off_step' };
  if (i.lastClose !== undefined && i.lastClose > 0 && Math.max(price / i.lastClose, i.lastClose / price) > i.sanity.maxCloseJumpRatio) {
    return { ok: false, reason: 'close_jump' };
  }

  let volume = 0;
  for (const b of todays) {
    if (typeof b.v !== 'number' || !Number.isSafeInteger(b.v) || b.v < 0) return { ok: false, reason: 'invalid_volume' };
    volume += b.v;
    if (!Number.isSafeInteger(volume)) return { ok: false, reason: 'invalid_volume' };
  }
  return { ok: true, quote: { symbol, ts: new Date(newestT * 1000).toISOString(), price, volume, source: i.source, fetchedAt: i.fetchedAt } };
}
