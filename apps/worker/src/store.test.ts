import { describe, expect, test, vi } from 'vitest';
import type { Db } from '@stoktok/db';

vi.mock('@stoktok/db', () => ({
  getEntrySettings: vi.fn(),
  getLatestCloses: vi.fn(),
  listHeldSymbols: vi.fn(),
  listWatchlist: vi.fn(async () => [
    { symbol: 'VNM', group: 'watching', addedAt: '2026-10-25T00:00:00Z' },
    { symbol: 'FPT', group: 'watching', addedAt: '2026-10-25T00:00:00Z' },
  ]),
  upsertPricesDaily: vi.fn(),
}));

import { createDbEodStore } from './store';

describe('createDbEodStore', () => {
  test('listWatchlistSymbols reads listWatchlist', async () => {
    const store = createDbEodStore({} as Db, { upsertChunkSize: 500 });
    expect(await store.listWatchlistSymbols()).toEqual(['VNM', 'FPT']);
  });
});
