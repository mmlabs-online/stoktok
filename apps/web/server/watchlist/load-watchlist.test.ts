import { DEFAULT_MARKET_RULES, DEFAULT_MARKET_SETTINGS } from '@stoktok/core';
import type { StoredClose, Transaction } from '@stoktok/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../db', async (importActual) => ({
  ...(await importActual<typeof import('../db')>()),
  listTransactions: vi.fn(),
  listCorporateActions: vi.fn(),
  getEntrySettings: vi.fn(),
  listWatchlist: vi.fn(),
  getMarketRules: vi.fn(),
  getSymbolExchanges: vi.fn(),
  getRecentCloses: vi.fn(),
}));

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
import { loadWatchlist } from './load-watchlist';

const db = {} as Db;
// Friday 2026-10-23 20:00 VN: after the cutoff, expected date is 2026-10-23.
const now = new Date('2026-10-23T13:00:00Z');
const settings = { ...DEFAULT_MARKET_SETTINGS, feeRatePpm: 1500 };

const buy = (id: string, symbol: string, quantity: number): Transaction => ({
  id,
  seq: Number(id),
  tradeDate: '2026-10-01',
  symbol,
  side: 'buy',
  quantity,
  price: 100000,
  fee: 0,
  tax: 0,
});
const sell = (id: string, symbol: string, quantity: number): Transaction => ({ ...buy(id, symbol, quantity), side: 'sell', tradeDate: '2026-10-20' });
const watch = (symbol: string) => ({ symbol, group: 'watching', addedAt: '2026-10-22T00:00:00Z' });
const bar = (symbol: string, tradeDate: string, close: number): StoredClose => ({
  symbol,
  close,
  tradeDate,
  volume: 1000,
  source: 'test',
  fetchedAt: '2026-10-23T11:30:00Z',
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listTransactions).mockResolvedValue([buy('1', 'FPT', 300)]);
  vi.mocked(listCorporateActions).mockResolvedValue([]);
  vi.mocked(getEntrySettings).mockResolvedValue({ settings, feeRateConfigured: true });
  vi.mocked(listWatchlist).mockResolvedValue([watch('VNM')]);
  vi.mocked(getMarketRules).mockResolvedValue(DEFAULT_MARKET_RULES);
  vi.mocked(getSymbolExchanges).mockResolvedValue({ FPT: 'HOSE' });
  vi.mocked(getRecentCloses).mockResolvedValue({
    FPT: [bar('FPT', '2026-10-23', 125_000), bar('FPT', '2026-10-22', 120_000)],
    VNM: [],
  });
});

describe('loadWatchlist', () => {
  it('holdings come from the ledger, not the watchlist table', async () => {
    const r = await loadWatchlist(db, now);
    expect(r.holdings.ok && r.holdings.rows.map((x) => x.symbol)).toEqual(['FPT']);
    expect(r.watching.map((x) => x.symbol)).toEqual(['VNM']);
  });
  it('builds the refresh bar view', async () => {
    const r = await loadWatchlist(db, now);
    expect(r.refreshBar).toMatchObject({ state: 'closed', sessionOpen: false, nextInMs: 0, intervalMs: 30_000 });
  });
  it('held+watched symbol shown once in Holdings, listed in alsoWatched', async () => {
    vi.mocked(listWatchlist).mockResolvedValue([watch('FPT'), watch('VNM')]);
    const r = await loadWatchlist(db, now);
    expect(r.holdings.ok && r.holdings.rows.map((x) => x.symbol)).toEqual(['FPT']);
    expect(r.watching.map((x) => x.symbol)).toEqual(['VNM']);
    expect(r.alsoWatched).toEqual(['FPT']);
  });
  it('passes rules, exchanges, ex-dates and holidays into rows', async () => {
    const r = await loadWatchlist(db, now);
    if (!r.holdings.ok) throw new Error('expected ok');
    const fpt = r.holdings.rows[0];
    expect(fpt).toMatchObject({ exchange: 'HOSE', ref: 120_000, ceiling: 128_400, floor: 111_600, priceDateDiffers: false });
    expect(r.watching[0]).toMatchObject({ exchange: null, status: 'missing', ceiling: null });
    expect(getRecentCloses).toHaveBeenCalledWith(db, ['FPT', 'VNM'], 2);

    vi.mocked(listCorporateActions).mockResolvedValue([
      { type: 'cash_dividend', id: 'c', symbol: 'FPT', exDate: '2026-10-23', amountPerShare: 1000 },
    ]);
    const ex = await loadWatchlist(db, now);
    expect(ex.holdings.ok && ex.holdings.rows[0]?.flags.exDate).toBe(true);
  });
  it('flags a stored close older than the expected date', async () => {
    vi.mocked(getRecentCloses).mockResolvedValue({
      FPT: [bar('FPT', '2026-10-22', 125_000), bar('FPT', '2026-10-21', 120_000)],
      VNM: [],
    });
    const r = await loadWatchlist(db, now);
    expect(r.holdings.ok && r.holdings.rows[0]).toMatchObject({ status: 'stale', priceDateDiffers: true });
  });
  it('ledger error -> holdings error, watching rows still returned', async () => {
    vi.mocked(listTransactions).mockResolvedValue([buy('1', 'FPT', 100), sell('2', 'FPT', 300)]);
    const r = await loadWatchlist(db, now);
    expect(r.holdings).toMatchObject({ ok: false, error: { code: 'OVERSELL' } });
    expect(r.watching.map((x) => x.symbol)).toEqual(['VNM']);
  });
  it('no symbols -> no price queries, empty groups', async () => {
    vi.mocked(listTransactions).mockResolvedValue([]);
    vi.mocked(listWatchlist).mockResolvedValue([]);
    const r = await loadWatchlist(db, now);
    expect(r).toMatchObject({ holdings: { ok: true, rows: [] }, watching: [], alsoWatched: [] });
    expect(getSymbolExchanges).not.toHaveBeenCalled();
    expect(getRecentCloses).not.toHaveBeenCalled();
  });
});
