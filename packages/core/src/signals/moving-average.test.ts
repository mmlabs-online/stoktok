import { describe, expect, test } from 'vitest';
import { DEFAULT_SIGNAL_RULES } from './config';
import { SIGNAL_DATE, closes, ctx } from './fixtures';
import { priceVsMa } from './moving-average';
import type { SymbolData } from './types';

const data = (cs: ReturnType<typeof closes>): SymbolData => ({ closes: cs, financials: [], sector: { sector: null, source: null, fetchedAt: null } });
// 10 closes: nine at 10,000 then the last one. ma(10) = (90,000 + last) / 10.
const withLast = (last: number) => closes('A', SIGNAL_DATE, 10, (i) => (i === 9 ? last : 10_000));

describe('priceVsMa', () => {
  test('close exactly at ma +- band -> bullish/bearish (inclusive); inside -> neutral', () => {
    // band 20,000 ppm = 2%. Last = 12,000 -> ma 10,200, value (1,800/10,200) ppm = 176,471 -> bullish.
    expect(priceVsMa('A', data(withLast(12_000)), 10, ctx())).toMatchObject({ status: 'ok', label: 'bullish', value: 176_471 });
    expect(priceVsMa('A', data(withLast(10_000)), 10, ctx())).toMatchObject({ label: 'neutral', value: 0 });
    // Constant window except last such that value == band: use band equal to the computed value.
    const rules = { ...DEFAULT_SIGNAL_RULES, priceVsMa: { ...DEFAULT_SIGNAL_RULES.priceVsMa, neutralBandPpm: 176_471 } };
    expect(priceVsMa('A', data(withLast(12_000)), 10, ctx({ rules })).label).toBe('bullish');
    expect(priceVsMa('A', data(withLast(8_000)), 10, ctx({ rules })).label).toBe('bearish');
    expect(priceVsMa('A', data(withLast(8_000)), 10, ctx()).value).toBe(-183_673);
  });
  test('20 stored bars, N=200 -> insufficient_history, dataFresh false', () => {
    const r = priceVsMa('A', data(closes('A', SIGNAL_DATE, 20)), 200, ctx());
    expect(r).toMatchObject({ status: 'suppressed', reasons: ['insufficient_history'], dataFresh: false, value: null, label: null, ruleId: 'price_vs_ma_200' });
  });
  test('latest bar yesterday -> price_stale; ma = roundDiv(sum,N); value integer', () => {
    const stale = priceVsMa('A', data(closes('A', '2026-10-23', 10)), 10, ctx());
    expect(stale.reasons).toEqual(['price_stale']);
    const r = priceVsMa('A', data(closes('A', SIGNAL_DATE, 3, (i) => [10_000, 10_010, 10_010][i] as number)), 3, ctx());
    expect(r.inputs.ma).toBe(10_007); // 30,020 / 3 = 10,006.67
    expect(Number.isSafeInteger(r.value)).toBe(true);
  });
  test('price gap inside the window -> price_gap with missingDates', () => {
    const cs = closes('A', SIGNAL_DATE, 11).filter((c) => c.tradeDate !== '2026-10-20');
    const r = priceVsMa('A', data(cs), 10, ctx());
    expect(r.reasons).toEqual(['price_gap']);
    expect(r.inputs.missingDates).toEqual(['2026-10-20']);
  });
  test('snapshot has the window with sources and fetched range', () => {
    const r = priceVsMa('A', data(withLast(10_000)), 10, ctx());
    expect(r.inputs.window).toMatchObject({ table: 'prices_daily', symbol: 'A', count: 10, sources: ['fake-prices'], minFetchedAt: '2026-10-26T11:30:00.000Z' });
  });
});
