import {
  getEntrySettings,
  getLatestCloses,
  insertGaps,
  listFinancials,
  listHeldSymbols,
  listOpenGaps,
  listWatchlist,
  resolveGaps,
  setSymbolSector,
  upsertFinancials,
  upsertPricesDaily,
} from '@stoktok/db';
import type { Db } from '@stoktok/db';
import type { EodStore } from './jobs/eod-sync';
import { FINANCIALS_GAP_TYPE } from './jobs/financials-sync';
import type { FinancialsStore } from './jobs/financials-sync';

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
