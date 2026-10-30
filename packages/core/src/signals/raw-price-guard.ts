/** Guards for MA rules that read raw (unadjusted) closes: corporate actions and limit-breaking jumps. Pure. */
import { previousTradingDay } from '../calendar';
import type { CorporateAction } from '../ledger/types';
import type { StoredClose } from '../market/price-board';
import { PPM, mulDiv } from '../money';
import { EXCHANGES } from '../settings/market-rules';
import type { Exchange } from '../settings/market-rules';
import { REASON_ORDER } from './types';
import type { ReasonCode, SnapshotRef } from './types';

export type PriceLimitPpm = Readonly<Record<Exchange, number>>;

/** The limit for an exchange; an unknown exchange uses the widest configured limit (R5). */
export function resolveLimitPpm(
  exchange: Exchange | null,
  priceLimitPpm: PriceLimitPpm,
): { limitPpm: number; exchangeUnknown: boolean } {
  if (exchange !== null) return { limitPpm: priceLimitPpm[exchange], exchangeUnknown: false };
  return { limitPpm: Math.max(...EXCHANGES.map((e) => priceLimitPpm[e])), exchangeUnknown: true };
}

/** True when |close - prev| / prev is strictly above the limit. An exact-limit day passes. Exact integer math. */
export function isBeyondDailyLimit(prevClose: number, close: number, limitPpm: number): boolean {
  if (prevClose <= 0) return false;
  const diff = BigInt(close) - BigInt(prevClose);
  const abs = diff < 0n ? -diff : diff;
  return abs * BigInt(PPM) > BigInt(limitPpm) * BigInt(prevClose);
}

export interface RawPriceJump {
  date: string;
  prevClose: number;
  close: number;
  movePpm: number;
}

export interface RawPriceGuardResult {
  reasons: ReasonCode[];
  exchange: Exchange | null;
  exchangeUnknown: boolean;
  limitPpmUsed: number;
  actionRefs: SnapshotRef[];
  jumps: RawPriceJump[];
}

/**
 * `window` is the complete MA window, oldest first. A stock dividend (any non-cash action) with
 * fromDate < exDate <= toDate, or a day-over-day close move beyond the daily limit between adjacent
 * trading days inside the window, makes the raw series unfit for an MA.
 */
export function checkRawPriceWindow(input: {
  symbol: string;
  window: readonly StoredClose[];
  exchange: Exchange | null;
  priceLimitPpm: PriceLimitPpm;
  actions: readonly CorporateAction[];
  holidays: readonly string[];
}): RawPriceGuardResult {
  const { window, holidays } = input;
  const { limitPpm, exchangeUnknown } = resolveLimitPpm(input.exchange, input.priceLimitPpm);
  const first = window[0];
  const last = window[window.length - 1];

  const actionRefs: SnapshotRef[] = [];
  if (first !== undefined && last !== undefined) {
    for (const a of input.actions) {
      if (a.symbol === input.symbol && a.type !== 'cash_dividend' && first.tradeDate < a.exDate && a.exDate <= last.tradeDate) {
        actionRefs.push({ ref: `corporate_actions:${a.id}` });
      }
    }
  }

  const jumps: RawPriceJump[] = [];
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1] as StoredClose;
    const cur = window[i] as StoredClose;
    if (previousTradingDay(cur.tradeDate, holidays) !== prev.tradeDate) continue;
    if (isBeyondDailyLimit(prev.close, cur.close, limitPpm)) {
      jumps.push({ date: cur.tradeDate, prevClose: prev.close, close: cur.close, movePpm: mulDiv(cur.close - prev.close, PPM, prev.close) });
    }
  }

  const found = new Set<ReasonCode>();
  if (actionRefs.length > 0) found.add('corporate_action_in_window');
  if (jumps.length > 0) found.add('price_jump_beyond_limit');
  const reasons = REASON_ORDER.filter((r) => found.has(r));
  return { reasons, exchange: input.exchange, exchangeUnknown, limitPpmUsed: limitPpm, actionRefs, jumps };
}
