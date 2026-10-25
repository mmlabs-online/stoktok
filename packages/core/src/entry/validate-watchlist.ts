import { normalizeSymbol } from '../symbol';
import { EXCHANGES } from '../settings/market-rules';
import type { Exchange } from '../settings/market-rules';
import type { EntryError } from './messages-vi';

export interface WatchlistFormRaw {
  symbol: string;
  exchange: string;
}

export type WatchlistField = keyof WatchlistFormRaw;

export interface WatchlistInput {
  symbol: string;
  /** null = unknown exchange (never defaulted). */
  exchange: Exchange | null;
}

export type ValidateWatchlistResult =
  | { ok: true; value: WatchlistInput }
  | { ok: false; errors: Partial<Record<WatchlistField, EntryError>> };

/** '' -> null (unknown); a known exchange (any case) -> Exchange; anything else is invalid. */
export function parseExchangeInput(raw: string): { ok: true; exchange: Exchange | null } | { ok: false } {
  const v = raw.trim().toUpperCase();
  if (v === '') return { ok: true, exchange: null };
  const found = EXCHANGES.find((e) => e === v);
  return found ? { ok: true, exchange: found } : { ok: false };
}

export function validateWatchlistInput(raw: WatchlistFormRaw): ValidateWatchlistResult {
  const errors: Partial<Record<WatchlistField, EntryError>> = {};
  let symbol = '';
  if (raw.symbol.trim() === '') errors.symbol = { code: 'REQUIRED' };
  else {
    const s = normalizeSymbol(raw.symbol);
    if (s === null) errors.symbol = { code: 'SYMBOL_INVALID' };
    else symbol = s;
  }
  const ex = parseExchangeInput(raw.exchange);
  if (!ex.ok) errors.exchange = { code: 'EXCHANGE_INVALID' };
  if (Object.keys(errors).length > 0 || !ex.ok) return { ok: false, errors };
  return { ok: true, value: { symbol, exchange: ex.exchange } };
}
