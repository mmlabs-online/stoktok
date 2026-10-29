import { describe, expect, test, vi } from 'vitest';
import type { Db } from '@stoktok/db';

vi.mock('@stoktok/db', () => ({
  getEntrySettings: vi.fn(),
  getFirstPriceDates: vi.fn(async () => ({})),
  getLatestCloses: vi.fn(),
  listPriceDates: vi.fn(async () => []),
  getRecentCloses: vi.fn(async () => ({})),
  getSignalRules: vi.fn(),
  listOpenMarketGaps: vi.fn(async () => []),
  listSymbolSectors: vi.fn(async () => ({})),
  upsertSignals: vi.fn(async () => 7),
  insertGaps: vi.fn(async () => undefined),
  listFinancials: vi.fn(async () => []),
  listOpenGaps: vi.fn(async () => []),
  resolveGaps: vi.fn(async () => undefined),
  setSymbolSector: vi.fn(async () => undefined),
  upsertFinancials: vi.fn(async () => 2),
  listHeldSymbols: vi.fn(),
  listWatchlist: vi.fn(async () => [
    { symbol: 'VNM', group: 'watching', addedAt: '2026-10-25T00:00:00Z' },
    { symbol: 'FPT', group: 'watching', addedAt: '2026-10-25T00:00:00Z' },
  ]),
  upsertPricesDaily: vi.fn(),
}));

import * as dbMock from '@stoktok/db';
import { createDbEodStore, createDbFinancialsStore, createDbSignalsStore } from './store';

describe('createDbEodStore', () => {
  test('listWatchlistSymbols reads listWatchlist', async () => {
    const store = createDbEodStore({} as Db, { upsertChunkSize: 500 });
    expect(await store.listWatchlistSymbols()).toEqual(['VNM', 'FPT']);
  });
  test('wires the gap reads and writes with prices_daily', async () => {
    const db = {} as Db;
    const store = createDbEodStore(db, { upsertChunkSize: 500 });
    await store.listOpenGaps(['VNM']);
    expect(dbMock.listOpenGaps).toHaveBeenCalledWith(db, 'prices_daily', ['VNM']);
    await store.insertGaps([]);
    expect(dbMock.insertGaps).toHaveBeenCalledWith(db, []);
    await store.resolveGaps([1], 'T');
    expect(dbMock.resolveGaps).toHaveBeenCalledWith(db, [1], 'T');
    await store.listPriceDates('VNM', 'a', 'b');
    expect(dbMock.listPriceDates).toHaveBeenCalledWith(db, 'VNM', 'a', 'b');
    await store.getFirstPriceDates(['VNM']);
    expect(dbMock.getFirstPriceDates).toHaveBeenCalledWith(db, ['VNM']);
  });
});

describe('createDbFinancialsStore', () => {
  test('wires to @stoktok/db functions', async () => {
    const db = {} as Db;
    const store = createDbFinancialsStore(db, { upsertChunkSize: 3 });
    expect(await store.listWatchlistSymbols()).toEqual(['VNM', 'FPT']);
    await store.listFinancials(['VNM'], '2025Q1');
    expect(dbMock.listFinancials).toHaveBeenCalledWith(db, ['VNM'], '2025Q1');
    expect(await store.upsertFinancials([])).toBe(2);
    expect(dbMock.upsertFinancials).toHaveBeenCalledWith(db, [], { chunkSize: 3 });
    await store.listOpenGaps(['VNM']);
    expect(dbMock.listOpenGaps).toHaveBeenCalledWith(db, 'financials', ['VNM']);
    await store.insertGaps([]);
    expect(dbMock.insertGaps).toHaveBeenCalledWith(db, []);
    await store.resolveGaps([1], 'T');
    expect(dbMock.resolveGaps).toHaveBeenCalledWith(db, [1], 'T');
    const v = { sector: 'x', source: 's', fetchedAt: 'T' };
    await store.setSymbolSector('VNM', v);
    expect(dbMock.setSymbolSector).toHaveBeenCalledWith(db, 'VNM', v);
  });
});

describe('createDbSignalsStore', () => {
  test('listFinancials chunks by financialsSymbolChunk and concatenates', async () => {
    const db = {} as Db;
    vi.mocked(dbMock.listFinancials).mockClear();
    vi.mocked(dbMock.listFinancials).mockImplementation(async (_db, symbols) => symbols.map((symbol) => ({ symbol })) as never);
    const store = createDbSignalsStore(db, { upsertChunkSize: 3, financialsSymbolChunk: 2 });
    const out = await store.listFinancials(['A', 'B', 'C', 'D', 'E'], '2025Q1');
    expect(vi.mocked(dbMock.listFinancials).mock.calls.map((c) => c[1])).toEqual([['A', 'B'], ['C', 'D'], ['E']]);
    expect(out.map((r) => r.symbol)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
  test('wires the other reads and the upsert chunk size', async () => {
    const db = {} as Db;
    const store = createDbSignalsStore(db, { upsertChunkSize: 3, financialsSymbolChunk: 2 });
    await store.getRecentCloses(['A'], 200);
    expect(dbMock.getRecentCloses).toHaveBeenCalledWith(db, ['A'], 200);
    await store.listOpenGaps('prices_daily', ['A']);
    expect(dbMock.listOpenGaps).toHaveBeenCalledWith(db, 'prices_daily', ['A']);
    await store.listOpenMarketGaps('prices_daily');
    expect(dbMock.listOpenMarketGaps).toHaveBeenCalledWith(db, 'prices_daily');
    await store.listSymbolSectors(['A']);
    expect(dbMock.listSymbolSectors).toHaveBeenCalledWith(db, ['A']);
    expect(await store.upsertSignals([])).toBe(7);
    expect(dbMock.upsertSignals).toHaveBeenCalledWith(db, [], { chunkSize: 3 });
  });
});
