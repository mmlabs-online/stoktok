import { DEFAULT_MARKET_SETTINGS } from '@stoktok/core';
import type { Transaction } from '@stoktok/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../db', async (importActual) => ({
  ...(await importActual<typeof import('../db')>()),
  listTransactions: vi.fn(),
  listCorporateActions: vi.fn(),
  getEntrySettings: vi.fn(),
  listAssets: vi.fn(),
  getConcentrationThreshold: vi.fn(),
  getLatestCloses: vi.fn(),
}));

import {
  getConcentrationThreshold,
  getEntrySettings,
  getLatestCloses,
  listAssets,
  listCorporateActions,
  listTransactions,
} from '../db';
import type { Db } from '../db';
import { loadDashboard } from './load-dashboard';

const db = {} as Db;
// Friday 2026-10-23 20:00 VN (13:00Z): after the 18:00 cutoff.
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
const sell = (id: string, symbol: string, quantity: number): Transaction => ({
  id,
  seq: Number(id),
  tradeDate: '2026-10-20',
  symbol,
  side: 'sell',
  quantity,
  price: 100000,
  fee: 0,
  tax: 0,
});
const quote = (symbol: string, close: number, tradeDate = '2026-10-23') => ({
  symbol,
  close,
  tradeDate,
  source: 'test',
  fetchedAt: '2026-10-23T11:30:00Z',
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listTransactions).mockResolvedValue([buy('1', 'FPT', 300)]);
  vi.mocked(listCorporateActions).mockResolvedValue([]);
  vi.mocked(getEntrySettings).mockResolvedValue({ settings, feeRateConfigured: true });
  vi.mocked(listAssets).mockResolvedValue([]);
  vi.mocked(getConcentrationThreshold).mockResolvedValue(null);
  vi.mocked(getLatestCloses).mockResolvedValue({ FPT: quote('FPT', 120000) });
});

describe('loadDashboard', () => {
  it('fee rate NULL -> ok with feeRateConfigured false', async () => {
    vi.mocked(getEntrySettings).mockResolvedValue({ settings: { ...settings, feeRatePpm: 0 }, feeRateConfigured: false });
    const r = await loadDashboard(db, now);
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.feeRateConfigured).toBe(false);
  });
  it('settings row missing (defaults) -> ok', async () => {
    vi.mocked(getEntrySettings).mockResolvedValue({
      settings: { ...DEFAULT_MARKET_SETTINGS, feeRatePpm: 0 },
      feeRateConfigured: false,
    });
    expect((await loadDashboard(db, now)).kind).toBe('ok');
  });
  it('threshold NULL -> 200000; stored value is used', async () => {
    const a = await loadDashboard(db, now);
    if (a.kind === 'ok') expect(a.portfolio.totals.thresholdPpm).toBe(200_000);
    vi.mocked(getConcentrationThreshold).mockResolvedValue(350_000);
    const b = await loadDashboard(db, now);
    if (b.kind === 'ok') expect(b.portfolio.totals.thresholdPpm).toBe(350_000);
  });
  it('empty prices_daily -> all rows missing, no market value', async () => {
    vi.mocked(getLatestCloses).mockResolvedValue({});
    const r = await loadDashboard(db, now);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.portfolio.rows[0]).toMatchObject({ priceStatus: 'missing', marketValue: null, unrealizedPnl: null });
    expect(r.portfolio.totals.complete).toBe(false);
    expect(r.portfolio.totals).toMatchObject({ holdingsMarketValue: null, unrealizedPnl: null });
  });
  it('ledger OVERSELL -> ledgerError, nothing thrown', async () => {
    vi.mocked(listTransactions).mockResolvedValue([buy('1', 'FPT', 100), sell('2', 'FPT', 300)]);
    const r = await loadDashboard(db, now);
    expect(r).toMatchObject({ kind: 'ledgerError', error: { code: 'OVERSELL' } });
  });
  it('no transactions -> hasTransactions false', async () => {
    vi.mocked(listTransactions).mockResolvedValue([]);
    const r = await loadDashboard(db, now);
    expect(r.kind === 'ok' && r.hasTransactions).toBe(false);
  });
  it('only qty > 0 symbols are passed to getLatestCloses', async () => {
    vi.mocked(listTransactions).mockResolvedValue([buy('1', 'FPT', 100), sell('2', 'FPT', 100), buy('3', 'VNM', 100)]);
    await loadDashboard(db, now);
    expect(getLatestCloses).toHaveBeenCalledWith(db, ['VNM']);
  });
  it('passes assets into totals', async () => {
    vi.mocked(listAssets).mockResolvedValue([
      { id: 'a', type: 'cash', name: 'TCBS', value: 5_000_000, asOf: '2026-10-20' },
      { id: 'b', type: 'other', name: 'Vàng', value: 2_000_000, asOf: '2026-10-20' },
    ]);
    const r = await loadDashboard(db, now);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.portfolio.totals).toMatchObject({ cash: 5_000_000, otherAssets: 2_000_000, netWorth: 300 * 120000 + 7_000_000 });
  });
});
