import { getEntrySettings, getLatestCloses, listHeldSymbols, listWatchlist, upsertPricesDaily } from '@stoktok/db';
import type { Db } from '@stoktok/db';
import type { EodStore } from './jobs/eod-sync';

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
