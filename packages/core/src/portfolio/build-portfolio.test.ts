import { describe, expect, it } from 'vitest';
import type { Holding } from '../ledger/types';
import { buildPortfolio } from './build-portfolio';
import type { PriceQuote } from './build-portfolio';
import { DEFAULT_CONCENTRATION_THRESHOLD_PPM, resolveConcentrationThreshold } from './config';

const EXPECTED = '2026-10-23';

const holding = (symbol: string, quantity: number, totalCost: number, extra: Partial<Holding> = {}): Holding => ({
  symbol,
  quantity,
  sellableQuantity: quantity,
  totalCost,
  averageCost: quantity > 0 ? Math.round(totalCost / quantity) : null,
  realizedPnl: 0,
  dividendCashNet: 0,
  ...extra,
});
const quote = (symbol: string, close: number, tradeDate = EXPECTED): PriceQuote => ({
  symbol,
  close,
  tradeDate,
  source: 'test',
  fetchedAt: '2026-10-23T11:30:00Z',
});
const quotes = (...qs: PriceQuote[]) => Object.fromEntries(qs.map((q) => [q.symbol, q]));

function build(
  holdings: Holding[],
  qs: PriceQuote[] = [],
  assets: { type: 'cash' | 'other'; value: number }[] = [],
  thresholdPpm = DEFAULT_CONCENTRATION_THRESHOLD_PPM,
) {
  return buildPortfolio({
    holdings,
    quotes: quotes(...qs),
    assets,
    expectedPriceDate: EXPECTED,
    concentrationThresholdPpm: thresholdPpm,
  });
}

describe('valuation', () => {
  it('MV = qty x close exactly, even when the product exceeds 2^53 in intermediates', () => {
    const p = build([holding('AAA', 99_999_999, 8_000_000_000_000_000)], [quote('AAA', 90_000_000)]);
    expect(p.rows[0]?.marketValue).toBe(8_999_999_910_000_000);
    expect(p.rows[0]?.unrealizedPnl).toBe(999_999_910_000_000);
  });
  it('unrealized = MV - totalCost', () => {
    const p = build([holding('AAA', 100, 1_000_001)], [quote('AAA', 12_000)]);
    expect(p.rows[0]?.unrealizedPnl).toBe(1_200_000 - 1_000_001);
  });
  it('P&L % rounds half away from zero (negative)', () => {
    // -1 / 16 000 000 rounds to 0 ppm
    const p = build([holding('AAA', 1, 16_000_000)], [quote('AAA', 15_999_999)]);
    expect(p.rows[0]?.unrealizedPnlPpm).toBe(0);
    const r = build([holding('CCC', 1, 2_000_000)], [quote('CCC', 1_999_999)]);
    // -1/2_000_000 = -0.5 ppm -> -1
    expect(r.rows[0]?.unrealizedPnlPpm).toBe(-1);
  });
  it('totalCost 0 -> unrealizedPnlPpm null', () => {
    const p = build([holding('AAA', 10, 0)], [quote('AAA', 1000)]);
    expect(p.rows[0]?.unrealizedPnlPpm).toBeNull();
  });
});

describe('rows', () => {
  it('excludes qty-0 symbols and passes sellableQuantity through', () => {
    const p = build(
      [holding('AAA', 200, 100, { sellableQuantity: 100 }), holding('OLD', 0, 0)],
      [quote('AAA', 1000)],
    );
    expect(p.rows.map((r) => r.symbol)).toEqual(['AAA']);
    expect(p.rows[0]?.sellableQuantity).toBe(100);
  });
  it('sorts by MV desc, unpriced last by symbol', () => {
    const p = build(
      [holding('ZZZ', 1, 1), holding('AAA', 1, 1), holding('SMALL', 1, 1), holding('BIG', 1, 1)],
      [quote('SMALL', 1000), quote('BIG', 5000)],
    );
    expect(p.rows.map((r) => r.symbol)).toEqual(['BIG', 'SMALL', 'AAA', 'ZZZ']);
  });
});

describe('weights', () => {
  it('denominator = sum of priced MV; unpriced has null weight', () => {
    const p = build(
      [holding('AAA', 1, 1), holding('BBB', 3, 1), holding('NOP', 5, 1)],
      [quote('AAA', 1000), quote('BBB', 1000)],
    );
    const by = Object.fromEntries(p.rows.map((r) => [r.symbol, r]));
    expect(by.AAA?.weightPpm).toBe(250_000);
    expect(by.BBB?.weightPpm).toBe(750_000);
    expect(by.NOP?.weightPpm).toBeNull();
    expect(by.NOP?.weightBarPct).toBeNull();
    expect(p.totals.holdingsMarketValue).toBe(4000);
    expect(by.AAA?.weightBarPct).toBe(25);
    expect(by.BBB?.weightBarPct).toBe(75);
  });
  it('denominator 0 -> all weights null without throwing', () => {
    const none = build([holding('AAA', 1, 1)]);
    expect(none.rows[0]?.weightPpm).toBeNull();
    const zero = build([holding('AAA', 1, 1)], [quote('AAA', 0)]);
    expect(zero.rows[0]?.weightPpm).toBeNull();
    expect(zero.rows[0]?.overConcentration).toBe(false);
  });
});

describe('concentration', () => {
  const two = (aQty: number, threshold?: number) =>
    build([holding('AAA', aQty, 1), holding('BBB', 100 - aQty, 1)], [quote('AAA', 1000), quote('BBB', 1000)], [], threshold);
  it('just below, exactly equal, just above the threshold', () => {
    expect(two(19).rows.find((r) => r.symbol === 'AAA')?.overConcentration).toBe(false);
    expect(two(20).rows.find((r) => r.symbol === 'AAA')?.overConcentration).toBe(false);
    expect(two(21).rows.find((r) => r.symbol === 'AAA')?.overConcentration).toBe(true);
  });
  it('uses the exact comparison, not the rounded weight', () => {
    // weight = 200000.4 ppm rounds to 200000 but exceeds 200000
    const p = build(
      [holding('AAA', 1_000_001, 1), holding('BBB', 3_999_999, 1)],
      [quote('AAA', 1000), quote('BBB', 1000)],
    );
    // 1_000_001 / 5_000_000 = 0.2000002
    const a = p.rows.find((r) => r.symbol === 'AAA');
    expect(a?.weightPpm).toBe(200_000);
    expect(a?.overConcentration).toBe(true);
  });
  it('single holding warns; explicit threshold honoured; 1 000 000 never warns', () => {
    expect(build([holding('AAA', 1, 1)], [quote('AAA', 1000)]).rows[0]?.overConcentration).toBe(true);
    expect(two(25, 300_000).rows.find((r) => r.symbol === 'AAA')?.overConcentration).toBe(false);
    expect(build([holding('AAA', 1, 1)], [quote('AAA', 1000)], [], 1_000_000).rows[0]?.overConcentration).toBe(false);
  });
  it('unpriced row never warns; totals list the symbols', () => {
    const p = build([holding('AAA', 1, 1), holding('NOP', 1, 1)], [quote('AAA', 1000)]);
    expect(p.rows.find((r) => r.symbol === 'NOP')?.overConcentration).toBe(false);
    expect(p.totals.overConcentrated).toEqual(['AAA']);
    expect(p.totals.thresholdPpm).toBe(200_000);
  });
  it('resolveConcentrationThreshold: null -> 200000, explicit kept', () => {
    expect(resolveConcentrationThreshold(null)).toBe(200_000);
    expect(resolveConcentrationThreshold(300_000)).toBe(300_000);
    expect(resolveConcentrationThreshold(0)).toBe(0);
  });
});

describe('realized', () => {
  it('sums all holdings including qty-0; dividends separate and outside net worth', () => {
    const p = build(
      [
        holding('AAA', 1, 500, { realizedPnl: 1000, dividendCashNet: 70 }),
        holding('OLD', 0, 0, { realizedPnl: -300, dividendCashNet: 30 }),
      ],
      [quote('AAA', 1000)],
    );
    expect(p.totals.realizedPnl).toBe(700);
    expect(p.totals.dividendCashNet).toBe(100);
    expect(p.totals.netWorth).toBe(1000);
  });
});

describe('net worth', () => {
  const assets = [
    { type: 'cash' as const, value: 5_000 },
    { type: 'cash' as const, value: 2_500 },
    { type: 'other' as const, value: 10_000 },
  ];
  it('all priced: MV + cash + other; cash and other split; several cash rows summed', () => {
    const p = build([holding('AAA', 10, 1)], [quote('AAA', 1000)], assets);
    expect(p.totals).toMatchObject({
      holdingsMarketValue: 10_000,
      cash: 7_500,
      otherAssets: 10_000,
      nonStockAssets: 17_500,
      assetCount: 3,
      netWorth: 27_500,
      pricedCount: 1,
      missingCount: 0,
      staleCount: 0,
      complete: true,
    });
  });
  it('one missing is excluded and marks incomplete', () => {
    const p = build([holding('AAA', 10, 1), holding('NOP', 10, 1)], [quote('AAA', 1000)], assets);
    expect(p.totals).toMatchObject({ netWorth: 27_500, pricedCount: 1, missingCount: 1, complete: false });
  });
  it('stale is included and counted', () => {
    const p = build([holding('AAA', 10, 1)], [quote('AAA', 1000, '2026-10-20')], assets);
    expect(p.totals).toMatchObject({ netWorth: 27_500, staleCount: 1, complete: true });
    expect(p.rows[0]?.priceStatus).toBe('stale');
    expect(p.rows[0]?.priceDate).toBe('2026-10-20');
  });
  it('all missing: net worth = cash + other', () => {
    const p = build([holding('AAA', 10, 1)], [], assets);
    expect(p.totals).toMatchObject({
      holdingsMarketValue: null,
      unrealizedPnl: null,
      pricedCount: 0,
      complete: false,
      netWorth: 17_500,
    });
    expect(p.rows[0]?.marketValue).toBeNull();
  });
  it('no assets', () => {
    const p = build([holding('AAA', 10, 1)], [quote('AAA', 1000)]);
    expect(p.totals).toMatchObject({ cash: 0, otherAssets: 0, assetCount: 0, netWorth: 10_000 });
  });
});

describe('totals unrealized %', () => {
  it('sum of unrealized / sum of cost over priced rows only', () => {
    const p = build(
      [holding('AAA', 1, 1000), holding('BBB', 1, 3000), holding('NOP', 1, 99_999)],
      [quote('AAA', 1500), quote('BBB', 3000)],
    );
    // unrealized 500 over cost 4000 = 125000 ppm (mean of row % would be 250000)
    expect(p.totals.unrealizedPnl).toBe(500);
    expect(p.totals.holdingsCostPriced).toBe(4000);
    expect(p.totals.unrealizedPnlPpm).toBe(125_000);
  });
  it('cost 0 -> null', () => {
    expect(build([holding('AAA', 1, 0)], [quote('AAA', 1000)]).totals.unrealizedPnlPpm).toBeNull();
  });
});

describe('empty ledger', () => {
  it('rows [], zeros, complete', () => {
    const p = build([]);
    expect(p.rows).toEqual([]);
    expect(p.totals).toMatchObject({ netWorth: 0, realizedPnl: 0, missingCount: 0, complete: true, unrealizedPnlPpm: null });
  });
});
