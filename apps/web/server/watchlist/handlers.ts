import { normalizeSymbol, parseExchangeInput, validateWatchlistInput } from '@stoktok/core';
import type { EntryErrorCode, WatchlistFormRaw } from '@stoktok/core';
import { DataError, addToWatchlist, removeFromWatchlist, setSymbolExchange } from '../db';
import type { Db } from '../db';
import { failForm, fieldErrors, message } from '../transactions/handlers';
import type { FormState } from '../transactions/handlers';

/**
 * FormData -> raw strings -> core validation -> repo. Writes only `watchlist` and `symbols`;
 * holdings are never stored.
 * R6 is suspended: when it is restored, call requireUser() before getDb() in every caller.
 */

export type WatchFormState = FormState<WatchlistFormRaw>;
export type RemoveWatchState = FormState<Record<string, never>>;
export type ExchangeFormState = FormState<{ exchange: string }>;

const str = (fd: FormData, key: string) => String(fd.get(key) ?? '');

/** CONFLICT maps to the given code, other DataErrors to SAVE_FAILED; anything else is a bug and is rethrown. */
function fromThrown<V>(e: unknown, values: V, conflict: EntryErrorCode = 'SAVE_FAILED'): FormState<V> {
  if (!(e instanceof DataError)) throw e;
  return failForm(values, e.code === 'CONFLICT' ? conflict : 'SAVE_FAILED');
}

/** A blank exchange never wipes a known one: setSymbolExchange runs only when an exchange was chosen. */
export async function handleAddWatch(db: Db, fd: FormData): Promise<WatchFormState> {
  const values = { symbol: str(fd, 'symbol'), exchange: str(fd, 'exchange') };
  const v = validateWatchlistInput(values);
  if (!v.ok) return { ok: false, fieldErrors: fieldErrors(v.errors), values };
  try {
    if (v.value.exchange !== null) await setSymbolExchange(db, v.value.symbol, v.value.exchange);
    await addToWatchlist(db, v.value.symbol);
    return { ok: true };
  } catch (e) {
    return fromThrown(e, values, 'WATCHLIST_DUPLICATE');
  }
}

/** Idempotent: removing a symbol that is not stored is success. Never deletes from `symbols`. */
export async function handleRemoveWatch(db: Db, symbolRaw: string): Promise<RemoveWatchState> {
  const symbol = normalizeSymbol(symbolRaw);
  if (symbol === null) return failForm({}, 'SYMBOL_INVALID');
  try {
    await removeFromWatchlist(db, symbol);
    return { ok: true };
  } catch (e) {
    if (e instanceof DataError && e.code === 'NOT_FOUND') return { ok: true };
    return fromThrown(e, {});
  }
}

/** An explicit choice: '' clears the stored exchange. */
export async function handleSetExchange(db: Db, symbolRaw: string, fd: FormData): Promise<ExchangeFormState> {
  const values = { exchange: str(fd, 'exchange') };
  const symbol = normalizeSymbol(symbolRaw);
  if (symbol === null) return failForm(values, 'SYMBOL_INVALID');
  const ex = parseExchangeInput(values.exchange);
  if (!ex.ok) return { ok: false, fieldErrors: { exchange: message({ code: 'EXCHANGE_INVALID' }) }, values };
  try {
    await setSymbolExchange(db, symbol, ex.exchange);
    return { ok: true };
  } catch (e) {
    return fromThrown(e, values);
  }
}
