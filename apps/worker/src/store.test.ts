import { describe, expect, test, vi } from 'vitest';
import type { Db } from '@stoktok/db';

vi.mock('@stoktok/db', () => ({
  getEntrySettings: vi.fn(),
  getLatestCloses: vi.fn(),
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
import { createDbEodStore, createDbFinancialsStore } from './store';

describe('createDbEodStore', () => {
  test('listWatchlistSymbols reads listWatchlist', async () => {
    const store = createDbEodStore({} as Db, { upsertChunkSize: 500 });
    expect(await store.listWatchlistSymbols()).toEqual(['VNM', 'FPT']);
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
