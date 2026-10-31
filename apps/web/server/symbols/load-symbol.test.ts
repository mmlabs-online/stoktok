import { DEFAULT_MARKET_RULES, DEFAULT_MARKET_SETTINGS, DEFAULT_SIGNAL_RULES, RULE_VERSION } from '@stoktok/core';
import type { StoredClose, StoredSignal, Transaction } from '@stoktok/core';
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
  getFirstPriceDates: vi.fn(),
  listCloseHistory: vi.fn(),
  getSignalRules: vi.fn(),
  listLatestSignals: vi.fn(),
  listOpenGaps: vi.fn(),
  listOpenMarketGaps: vi.fn(),
}));

import {
  getEntrySettings,
  getFirstPriceDates,
  getMarketRules,
  getRecentCloses,
  getSignalRules,
  getSymbolExchanges,
  listCloseHistory,
  listCorporateActions,
  listLatestSignals,
  listOpenGaps,
  listOpenMarketGaps,
  listTransactions,
  listWatchlist,
} from '../db';
import type { Db } from '../db';
import { loadSymbol } from './load-symbol';

const db = {} as Db;
// Friday 2026-10-23 20:00 VN: after the cutoff, expected date is 2026-10-23.
const now = new Date('2026-10-23T13:00:00Z');
const settings = { ...DEFAULT_MARKET_SETTINGS, feeRatePpm: 1500 };

const buy = (id: string, symbol: string, quantity: number, tradeDate = '2026-10-01'): Transaction => ({
  id,
  seq: Number(id),
  tradeDate,
  symbol,
  side: 'buy',
  quantity,
  price: 100000,
  fee: 0,
  tax: 0,
});
const sell = (id: string, symbol: string, quantity: number): Transaction => ({
  ...buy(id, symbol, quantity, '2026-10-20'),
  side: 'sell',
});
const bar = (symbol: string, tradeDate: string, close: number): StoredClose => ({
  symbol,
  close,
  tradeDate,
  volume: 1000,
  source: 'test',
  fetchedAt: '2026-10-23T11:30:00Z',
});
const fptBars = { FPT: [bar('FPT', '2026-10-23', 125_000), bar('FPT', '2026-10-22', 120_000)] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listTransactions).mockResolvedValue([buy('1', 'FPT', 300)]);
  vi.mocked(listCorporateActions).mockResolvedValue([]);
  vi.mocked(getEntrySettings).mockResolvedValue({ settings, feeRateConfigured: true });
  vi.mocked(listWatchlist).mockResolvedValue([]);
  vi.mocked(getMarketRules).mockResolvedValue(DEFAULT_MARKET_RULES);
  vi.mocked(getSymbolExchanges).mockResolvedValue({ FPT: 'HOSE' });
  vi.mocked(getRecentCloses).mockResolvedValue(fptBars);
  vi.mocked(getFirstPriceDates).mockResolvedValue({ FPT: '2026-10-22' });
  vi.mocked(listCloseHistory).mockResolvedValue([...fptBars.FPT].reverse());
  vi.mocked(listOpenGaps).mockResolvedValue([]);
  vi.mocked(listOpenMarketGaps).mockResolvedValue([]);
  vi.mocked(getSignalRules).mockResolvedValue(DEFAULT_SIGNAL_RULES);
  vi.mocked(listLatestSignals).mockResolvedValue([]);
});

describe('loadSymbol', () => {
  it('returns null for a symbol with no symbols row, watchlist entry, transaction, corporate action or price', async () => {
    vi.mocked(listTransactions).mockResolvedValue([buy('1', 'VNM', 100)]);
    vi.mocked(getSymbolExchanges).mockResolvedValue({});
    vi.mocked(getRecentCloses).mockResolvedValue({});
    expect(await loadSymbol(db, 'FPT', now)).toBeNull();
  });

  describe('each single source makes the symbol known', () => {
    const none = () => {
      vi.mocked(listTransactions).mockResolvedValue([]);
      vi.mocked(getSymbolExchanges).mockResolvedValue({});
      vi.mocked(getRecentCloses).mockResolvedValue({});
    };
    it('symbols row only', async () => {
      none();
      vi.mocked(getSymbolExchanges).mockResolvedValue({ FPT: null });
      expect(await loadSymbol(db, 'FPT', now)).not.toBeNull();
    });
    it('watchlist only', async () => {
      none();
      vi.mocked(listWatchlist).mockResolvedValue([{ symbol: 'FPT', group: 'watching', addedAt: '2026-10-22T00:00:00Z' }]);
      expect(await loadSymbol(db, 'FPT', now)).not.toBeNull();
    });
    it('price only', async () => {
      none();
      vi.mocked(getRecentCloses).mockResolvedValue(fptBars);
      expect(await loadSymbol(db, 'FPT', now)).not.toBeNull();
    });
    it('corporate action only', async () => {
      none();
      vi.mocked(listCorporateActions).mockResolvedValue([
        { type: 'cash_dividend', id: 'c', symbol: 'FPT', exDate: '2026-10-01', amountPerShare: 1000 },
      ]);
      expect(await loadSymbol(db, 'FPT', now)).not.toBeNull();
    });
    it('transaction only', async () => {
      none();
      vi.mocked(listTransactions).mockResolvedValue([buy('1', 'FPT', 100)]);
      expect(await loadSymbol(db, 'FPT', now)).not.toBeNull();
    });
  });

  it('header comes from buildPriceBoardRow', async () => {
    const v = await loadSymbol(db, 'FPT', now);
    expect(v?.header).toMatchObject({ exchange: 'HOSE', ref: 120_000, ceiling: 128_400, floor: 111_600, priceDateDiffers: false });
    expect(v?.refEstimated).toBe(false);
    expect(getRecentCloses).toHaveBeenCalledWith(db, ['FPT'], 2);
  });
  it('ex-date from a corporate action sets flags.exDate', async () => {
    vi.mocked(listCorporateActions).mockResolvedValue([
      { type: 'cash_dividend', id: 'c', symbol: 'FPT', exDate: '2026-10-23', amountPerShare: 1000 },
    ]);
    expect((await loadSymbol(db, 'FPT', now))?.header.flags.exDate).toBe(true);
  });
  it('stale close sets status stale and priceDateDiffers', async () => {
    vi.mocked(getRecentCloses).mockResolvedValue({
      FPT: [bar('FPT', '2026-10-22', 125_000), bar('FPT', '2026-10-21', 120_000)],
    });
    expect((await loadSymbol(db, 'FPT', now))?.header).toMatchObject({ status: 'stale', priceDateDiffers: true });
  });
  it('UPCOM sets refEstimated', async () => {
    vi.mocked(getSymbolExchanges).mockResolvedValue({ FPT: 'UPCOM' });
    expect((await loadSymbol(db, 'FPT', now))?.refEstimated).toBe(true);
  });

  it('position equals core: quantity, sellableQuantity, averageCost, unrealizedPnl', async () => {
    vi.mocked(listTransactions).mockResolvedValue([buy('1', 'FPT', 300), buy('2', 'FPT', 100, '2026-10-22')]);
    const p = (await loadSymbol(db, 'FPT', now))?.position;
    if (p?.kind !== 'open') throw new Error('expected open');
    expect(p.row).toMatchObject({ quantity: 400, sellableQuantity: 300, averageCost: 100_000, unrealizedPnl: 10_000_000, priceStatus: 'fresh' });
    expect(p.settlementDays).toBe(settings.settlementDays);
  });
  it('lots: only this symbol, remaining > 0, pending lot has sellableFrom = T+2 trading days', async () => {
    vi.mocked(listTransactions).mockResolvedValue([
      buy('1', 'FPT', 300),
      buy('2', 'FPT', 100, '2026-10-22'),
      buy('3', 'VNM', 50),
    ]);
    const p = (await loadSymbol(db, 'FPT', now))?.position;
    if (p?.kind !== 'open') throw new Error('expected open');
    expect(p.lots.map((l) => l.symbol)).toEqual(['FPT', 'FPT']);
    expect(p.lots[1]).toMatchObject({ status: 'pending', sellableFrom: '2026-10-26' });
  });
  it('partial sell reduces lot remaining; multiple lots kept in acquired order', async () => {
    vi.mocked(listTransactions).mockResolvedValue([
      buy('1', 'FPT', 300),
      buy('2', 'FPT', 100, '2026-10-05'),
      sell('3', 'FPT', 100),
    ]);
    const p = (await loadSymbol(db, 'FPT', now))?.position;
    if (p?.kind !== 'open') throw new Error('expected open');
    expect(p.lots.map((l) => [l.acquiredOn, l.quantityRemaining])).toEqual([
      ['2026-10-01', 200],
      ['2026-10-05', 100],
    ]);
  });
  it('stock dividend lot is listed with source stock_dividend', async () => {
    vi.mocked(listCorporateActions).mockResolvedValue([
      { type: 'stock_dividend', id: 's', symbol: 'FPT', exDate: '2026-10-10', ratio: { held: 100, received: 10 } },
    ]);
    const p = (await loadSymbol(db, 'FPT', now))?.position;
    if (p?.kind !== 'open') throw new Error('expected open');
    expect(p.lots.some((l) => l.source === 'stock_dividend' && l.quantityRemaining === 30)).toBe(true);
  });
  it('cash dividend shows in dividendCashNet', async () => {
    vi.mocked(listCorporateActions).mockResolvedValue([
      { type: 'cash_dividend', id: 'c', symbol: 'FPT', exDate: '2026-10-10', amountPerShare: 1000 },
    ]);
    const p = (await loadSymbol(db, 'FPT', now))?.position;
    if (p?.kind !== 'open') throw new Error('expected open');
    expect(p.holding.dividendCashNet).toBeGreaterThan(0);
  });
  it("fully sold -> kind 'closed' with realizedPnl, no lots", async () => {
    vi.mocked(listTransactions).mockResolvedValue([buy('1', 'FPT', 300), sell('2', 'FPT', 300)]);
    const p = (await loadSymbol(db, 'FPT', now))?.position;
    expect(p).toMatchObject({ kind: 'closed', holding: { quantity: 0 } });
    expect(p && 'lots' in p).toBe(false);
  });
  it("watched-only symbol -> position kind 'none'", async () => {
    vi.mocked(listTransactions).mockResolvedValue([]);
    vi.mocked(listWatchlist).mockResolvedValue([{ symbol: 'FPT', group: 'watching', addedAt: '2026-10-22T00:00:00Z' }]);
    expect((await loadSymbol(db, 'FPT', now))?.position).toEqual({ kind: 'none' });
  });
  it('no stored price -> unrealizedPnl null, priceStatus missing', async () => {
    vi.mocked(getRecentCloses).mockResolvedValue({ FPT: [] });
    const p = (await loadSymbol(db, 'FPT', now))?.position;
    if (p?.kind !== 'open') throw new Error('expected open');
    expect(p.row).toMatchObject({ unrealizedPnl: null, priceStatus: 'missing' });
  });
  it("OVERSELL elsewhere in the ledger -> position kind 'ledgerError', header and transactions still returned", async () => {
    vi.mocked(listTransactions).mockResolvedValue([buy('1', 'FPT', 300), buy('2', 'VNM', 100), sell('3', 'VNM', 300)]);
    const v = await loadSymbol(db, 'FPT', now);
    expect(v?.position).toMatchObject({ kind: 'ledgerError', error: { code: 'OVERSELL' } });
    expect(v?.header.close).toBe(125_000);
    expect(v?.transactions).toHaveLength(1);
  });

  it('transactions are this symbol only, newest first, capped, with ledgerHref', async () => {
    const many = Array.from({ length: 12 }, (_, i) => buy(String(i + 1), 'FPT', 100, `2026-09-${String(i + 1).padStart(2, '0')}`));
    vi.mocked(listTransactions).mockResolvedValue([...many, buy('99', 'VNM', 10)]);
    const v = await loadSymbol(db, 'FPT', now);
    expect(v?.transactions).toHaveLength(10);
    expect(v?.transactions[0]?.id).toBe('12');
    expect(v?.transactions.every((t) => t.symbol === 'FPT')).toBe(true);
    expect(v?.transactionCount).toBe(12);
    expect(v?.ledgerHref).toBe('/transactions?symbol=FPT');
  });
});

describe('loadSymbol chart', () => {
  it('reads history for the range window and both gap lists', async () => {
    vi.mocked(getFirstPriceDates).mockResolvedValue({ FPT: '2025-01-02' });
    const view = await loadSymbol(db, 'FPT', now, '1T');
    expect(listCloseHistory).toHaveBeenCalledWith(db, 'FPT', '2026-09-23', '2026-10-23');
    expect(listOpenGaps).toHaveBeenCalledWith(db, 'prices_daily', ['FPT']);
    expect(listOpenMarketGaps).toHaveBeenCalledWith(db, 'prices_daily');
    expect(view?.chart.hasData).toBe(true);
    expect(view?.chart.window).toEqual({ from: '2026-09-23', to: '2026-10-23', trimmed: false });
  });

  it('defaults to 3T and echoes the passed range', async () => {
    expect((await loadSymbol(db, 'FPT', now))?.chartRange).toBe('3T');
    expect((await loadSymbol(db, 'FPT', now, '6T'))?.chartRange).toBe('6T');
  });

  it('does not read history without stored prices', async () => {
    vi.mocked(getFirstPriceDates).mockResolvedValue({});
    vi.mocked(getRecentCloses).mockResolvedValue({});
    const view = await loadSymbol(db, 'FPT', now);
    expect(listCloseHistory).not.toHaveBeenCalled();
    expect(view?.chart.hasData).toBe(false);
  });

  it('a market-wide gap reaches the chart as gap_recorded', async () => {
    vi.mocked(listCloseHistory).mockResolvedValue([bar('FPT', '2026-10-23', 125_000)]);
    vi.mocked(listOpenMarketGaps).mockResolvedValue([
      { id: 9, symbol: null, fromTs: '2026-10-21T17:00:00.000Z', toTs: '2026-10-22T16:59:59.000Z' },
    ]);
    const view = await loadSymbol(db, 'FPT', now);
    expect(view?.chart.slots.find((s) => s.date === '2026-10-22')).toMatchObject({ kind: 'gap_recorded', gapId: 9 });
  });
});

describe('loadSymbol signals', () => {
  const stored = (ruleId: string, over: Partial<StoredSignal> = {}): StoredSignal => ({
    symbol: 'FPT',
    ruleId,
    signalDate: '2026-10-23',
    status: 'ok',
    label: 'bullish',
    value: 32_000,
    reasonCodes: [],
    inputs: {
      refs: [{ ref: 'financials:FPT:2026Q2', source: 'vnd', fetchedAt: '2026-10-22T10:00:00Z' }],
    },
    ruleVersion: RULE_VERSION,
    computedAt: '2026-10-23T12:00:00Z',
    ...over,
  });

  it('reads signal rules, both gap types, and listLatestSignals with expectedRuleIds', async () => {
    await loadSymbol(db, 'FPT', now);
    expect(getSignalRules).toHaveBeenCalledWith(db);
    expect(listOpenGaps).toHaveBeenCalledWith(db, 'financials', ['FPT']);
    expect(listOpenMarketGaps).toHaveBeenCalledWith(db, 'financials');
    expect(listLatestSignals).toHaveBeenCalledWith(db, 'FPT', [
      'pe_vs_sector',
      'pb_vs_sector',
      'earnings_growth_trend',
      'price_vs_ma_50',
      'price_vs_ma_200',
    ]);
  });
  it('no stored signals -> empty section', async () => {
    expect((await loadSymbol(db, 'FPT', now))?.signals).toEqual({ kind: 'empty' });
  });
  it('a current signal is listed', async () => {
    vi.mocked(listLatestSignals).mockResolvedValue([stored('pb_vs_sector')]);
    const s = (await loadSymbol(db, 'FPT', now))?.signals;
    expect(s).toMatchObject({ kind: 'list', summaryText: '1 tín hiệu, 0 tạm ẩn' });
  });
  it('signals hidden when signal_date < expected date', async () => {
    vi.mocked(listLatestSignals).mockResolvedValue([stored('pb_vs_sector', { signalDate: '2026-10-22' })]);
    expect((await loadSymbol(db, 'FPT', now))?.signals).toEqual({
      kind: 'hidden',
      lastSignalDateText: '22/10/2026',
      causes: ['Tín hiệu chưa được tính lại cho phiên 23/10/2026'],
    });
  });
  it("financials gap from listOpenGaps('financials') hides the P/B row", async () => {
    vi.mocked(listLatestSignals).mockResolvedValue([stored('pb_vs_sector')]);
    vi.mocked(listOpenGaps).mockImplementation(async (_db, type) =>
      type === 'financials' ? [{ id: 5, symbol: 'FPT', fromTs: '2026-03-31T17:00:00.000Z', toTs: '2026-06-30T16:59:59.000Z' }] : [],
    );
    const s = (await loadSymbol(db, 'FPT', now))?.signals;
    expect(s).toMatchObject({ kind: 'hidden', causes: [expect.stringContaining('BCTC')] });
  });
  it('price gaps are read once and shared by chart and signals', async () => {
    await loadSymbol(db, 'FPT', now);
    expect(vi.mocked(listOpenGaps).mock.calls.filter((c) => c[1] === 'prices_daily')).toHaveLength(1);
    expect(vi.mocked(listOpenMarketGaps).mock.calls.filter((c) => c[1] === 'prices_daily')).toHaveLength(1);
  });
});
