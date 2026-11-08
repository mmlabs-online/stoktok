import {
  getEntrySettings,
  getFirstPriceDates,
  getLatestCloses,
  getMarketRules,
  getRecentCloses,
  getSignalRules,
  getSymbolExchanges,
  insertGaps,
  listAllOpenGaps,
  listCorporateActions,
  listFinancialLines,
  listFinancials,
  listHeldSymbols,
  listOpenGaps,
  listOpenMarketGaps,
  listPriceDates,
  listSymbolSectors,
  listWatchlist,
  resolveGaps,
  setSymbolSector,
  upsertFinancialLines,
  upsertFinancials,
  upsertPricesDaily,
  upsertSignals,
} from '@stoktok/db';
import type { Db } from '@stoktok/db';
import type { HolidayGapsConfig } from './config';
import { PRICES_GAP_TYPE } from './jobs/eod-sync';
import type { EodStore } from './jobs/eod-sync';
import type { FinancialStatementsStore } from './jobs/financial-statements-sync';
import { FINANCIALS_GAP_TYPE } from './jobs/financials-sync';
import type { FinancialsStore } from './jobs/financials-sync';
import type { HolidayGapsStore } from './jobs/resolve-holiday-gaps';
import type { SignalsStore } from './jobs/medium-signals';

/** Wiring only: all reads and writes go through @stoktok/db. */
export function createDbEodStore(db: Db, opts: { upsertChunkSize: number }): EodStore {
  return {
    getHolidays: async () => (await getEntrySettings(db)).settings.holidays,
    listWatchlistSymbols: async () => (await listWatchlist(db)).map((w) => w.symbol),
    listHeldSymbols: (asOf) => listHeldSymbols(db, asOf),
    getLatestCloses: async (symbols) => {
      const quotes = await getLatestCloses(db, symbols);
      return Object.fromEntries(Object.entries(quotes).map(([s, q]) => [s, q.close]));
    },
    upsertPricesDaily: (rows) => upsertPricesDaily(db, rows, { chunkSize: opts.upsertChunkSize }),
    listPriceDates: (symbol, from, to) => listPriceDates(db, symbol, from, to),
    getFirstPriceDates: (symbols) => getFirstPriceDates(db, symbols),
    listOpenGaps: (symbols) => listOpenGaps(db, PRICES_GAP_TYPE, symbols),
    insertGaps: (rows) => insertGaps(db, rows),
    resolveGaps: (ids, resolvedAt, reason) => resolveGaps(db, ids, resolvedAt, reason),
  };
}

/** Wiring only. Holidays are the effective list (seed plus stored). */
export function createDbHolidayGapsStore(db: Db, cfg: HolidayGapsConfig): HolidayGapsStore {
  return {
    getHolidays: async () => (await getEntrySettings(db)).settings.holidays,
    listAllOpenGaps: () => listAllOpenGaps(db, PRICES_GAP_TYPE, { pageSize: cfg.pageSize }),
    resolveGaps: (ids, resolvedAt, reason) => resolveGaps(db, ids, resolvedAt, reason),
  };
}

/** Wiring only: all reads and writes go through @stoktok/db. */
export function createDbFinancialsStore(db: Db, opts: { upsertChunkSize: number }): FinancialsStore {
  return {
    listWatchlistSymbols: async () => (await listWatchlist(db)).map((w) => w.symbol),
    listHeldSymbols: (asOf) => listHeldSymbols(db, asOf),
    listFinancials: (symbols, fromPeriod) => listFinancials(db, symbols, fromPeriod),
    upsertFinancials: (rows) => upsertFinancials(db, rows, { chunkSize: opts.upsertChunkSize }),
    listOpenGaps: (symbols) => listOpenGaps(db, FINANCIALS_GAP_TYPE, symbols),
    insertGaps: (rows) => insertGaps(db, rows),
    resolveGaps: (ids, resolvedAt) => resolveGaps(db, ids, resolvedAt),
    setSymbolSector: (symbol, v) => setSymbolSector(db, symbol, v),
  };
}

/** Wiring only: all reads and writes go through @stoktok/db. */
export function createDbFinancialStatementsStore(db: Db, opts: { upsertChunkSize: number }): FinancialStatementsStore {
  return {
    listWatchlistSymbols: async () => (await listWatchlist(db)).map((w) => w.symbol),
    listHeldSymbols: (asOf) => listHeldSymbols(db, asOf),
    listFinancialLines: (symbols, periodKind, fromPeriod) => listFinancialLines(db, symbols, periodKind, fromPeriod),
    upsertFinancialLines: (rows) => upsertFinancialLines(db, rows, { chunkSize: opts.upsertChunkSize }),
    listOpenGaps: (dataType, symbols) => listOpenGaps(db, dataType, symbols),
    insertGaps: (rows) => insertGaps(db, rows),
    resolveGaps: (ids, resolvedAt) => resolveGaps(db, ids, resolvedAt),
  };
}

/** Wiring only. Financials are read in symbol chunks so one response stays under the PostgREST row cap. */
export function createDbSignalsStore(db: Db, opts: { upsertChunkSize: number; financialsSymbolChunk: number }): SignalsStore {
  return {
    getHolidays: async () => (await getEntrySettings(db)).settings.holidays,
    getSignalRules: () => getSignalRules(db),
    listWatchlistSymbols: async () => (await listWatchlist(db)).map((w) => w.symbol),
    listHeldSymbols: (asOf) => listHeldSymbols(db, asOf),
    getRecentCloses: (symbols, n) => getRecentCloses(db, symbols, n),
    listFinancials: async (symbols, fromPeriod) => {
      const out = [];
      for (let i = 0; i < symbols.length; i += opts.financialsSymbolChunk) {
        out.push(...(await listFinancials(db, symbols.slice(i, i + opts.financialsSymbolChunk), fromPeriod)));
      }
      return out;
    },
    listSymbolSectors: (symbols) => listSymbolSectors(db, symbols),
    getMarketRules: () => getMarketRules(db),
    getSymbolExchanges: (symbols) => getSymbolExchanges(db, symbols),
    listCorporateActions: async (symbols) => {
      const out = [];
      for (let i = 0; i < symbols.length; i += opts.financialsSymbolChunk) {
        out.push(...(await listCorporateActions(db, { symbols: symbols.slice(i, i + opts.financialsSymbolChunk) })));
      }
      return out;
    },
    listOpenGaps: (dataType, symbols) => listOpenGaps(db, dataType, symbols),
    listOpenMarketGaps: (dataType) => listOpenMarketGaps(db, dataType),
    upsertSignals: (rows) => upsertSignals(db, rows, { chunkSize: opts.upsertChunkSize }),
  };
}
