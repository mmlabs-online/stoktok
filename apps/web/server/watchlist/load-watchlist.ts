import {
  DEFAULT_PRICE_CUTOFF_MINUTES_VN,
  DEFAULT_TICK_BANDS,
  buildLedger,
  buildPriceBoardRow,
  expectedPriceDate,
  splitWatchlistGroups,
  vnDateOf,
} from '@stoktok/core';
import type { Exchange, LedgerError, PriceBoardRow } from '@stoktok/core';
import {
  getEntrySettings,
  getMarketRules,
  getRecentCloses,
  getSymbolExchanges,
  listCorporateActions,
  listTransactions,
  listWatchlist,
} from '../db';
import type { Db } from '../db';

/** A board row plus the loader's freshness comparison, so components never compare dates. */
export interface WatchRow extends PriceBoardRow {
  /** True when the stored close is not the session the board expects (shown as "giá dd/mm/yyyy"). */
  priceDateDiffers: boolean;
}

export interface WatchlistView {
  holdings: { ok: true; rows: WatchRow[] } | { ok: false; error: LedgerError };
  watching: WatchRow[];
  /** Held symbols that are also in the watchlist table (shown once, in holdings). */
  alsoWatched: string[];
  expectedPriceDate: string;
}

/**
 * Reads stored data and delegates every calculation to core (R1).
 * R6 is suspended: when it is restored, call requireUser() at the top of this entry point.
 * Holdings are derived from the ledger and never stored.
 */
export async function loadWatchlist(db: Db, now: Date): Promise<WatchlistView> {
  const [txs, cas, entry, watchlist, rules] = await Promise.all([
    listTransactions(db),
    listCorporateActions(db),
    getEntrySettings(db),
    listWatchlist(db),
    getMarketRules(db),
  ]);
  const ledger = buildLedger(txs, cas, entry.settings, vnDateOf(now));
  const held = ledger.ok ? ledger.value.holdings.filter((h) => h.quantity > 0).map((h) => h.symbol) : [];
  const groups = splitWatchlistGroups(
    held,
    watchlist.map((w) => w.symbol),
  );
  const all = [...groups.holdings, ...groups.watching];
  const expected = expectedPriceDate(now, entry.settings.holidays, DEFAULT_PRICE_CUTOFF_MINUTES_VN);

  const [exchanges, closes] =
    all.length === 0
      ? [{} as Record<string, Exchange | null>, {}]
      : await Promise.all([getSymbolExchanges(db, all), getRecentCloses(db, all, 2)]);

  const row = (symbol: string): WatchRow => {
    const board = buildPriceBoardRow({
      symbol,
      bars: closes[symbol] ?? [],
      exchange: exchanges[symbol] ?? null,
      rules,
      tickBands: DEFAULT_TICK_BANDS,
      expectedDate: expected,
      holidays: entry.settings.holidays,
      exDates: cas.filter((c) => c.symbol === symbol).map((c) => c.exDate),
    });
    return { ...board, priceDateDiffers: board.tradeDate !== null && board.tradeDate !== expected };
  };

  return {
    holdings: ledger.ok
      ? { ok: true, rows: groups.holdings.map(row) }
      : { ok: false, error: ledger.error },
    watching: groups.watching.map(row),
    alsoWatched: groups.alsoWatched,
    expectedPriceDate: expected,
  };
}
