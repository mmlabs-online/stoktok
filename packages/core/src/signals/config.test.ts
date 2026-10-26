import { describe, expect, test } from 'vitest';
import { DEFAULT_SIGNAL_RULES, SIGNAL_RULE_BOUNDS, parseSignalRules } from './config';

const wrap = (medium: unknown) => ({ signals: { medium } });

describe('parseSignalRules', () => {
  test('null/{} -> DEFAULT_SIGNAL_RULES', () => {
    expect(parseSignalRules(null)).toEqual(DEFAULT_SIGNAL_RULES);
    expect(parseSignalRules({})).toEqual(DEFAULT_SIGNAL_RULES);
    expect(parseSignalRules([])).toEqual(DEFAULT_SIGNAL_RULES);
    expect(DEFAULT_SIGNAL_RULES.peVsSector.minPeers).toBe(5);
  });
  test('stored values are used', () => {
    const r = parseSignalRules(wrap({ peVsSector: { minPeers: 8, enabled: false }, priceVsMa: { shortDays: 20, longDays: 100 } }));
    expect(r.peVsSector).toMatchObject({ minPeers: 8, enabled: false, discountPpm: 200_000 });
    expect(r.priceVsMa).toMatchObject({ shortDays: 20, longDays: 100 });
  });
  test('each invalid key falls back on its own (string, float, below/above bound)', () => {
    const r = parseSignalRules(
      wrap({
        peVsSector: { minPeers: '8', discountPpm: 1.5, premiumPpm: 1_000_001, enabled: 'yes' },
        pbVsSector: { minPeers: 2, discountPpm: 100_000 },
        priceVsMa: { neutralBandPpm: 200_001 },
        freshness: { financialsMaxFetchAgeDays: 0 },
        earningsGrowth: { growthThresholdPpm: -1 },
      }),
    );
    expect(r.peVsSector).toEqual(DEFAULT_SIGNAL_RULES.peVsSector);
    expect(r.pbVsSector).toEqual({ ...DEFAULT_SIGNAL_RULES.pbVsSector, discountPpm: 100_000 });
    expect(r.priceVsMa.neutralBandPpm).toBe(DEFAULT_SIGNAL_RULES.priceVsMa.neutralBandPpm);
    expect(r.freshness).toEqual(DEFAULT_SIGNAL_RULES.freshness);
    expect(r.earningsGrowth.growthThresholdPpm).toBe(DEFAULT_SIGNAL_RULES.earningsGrowth.growthThresholdPpm);
  });
  test('bounds are inclusive', () => {
    const b = SIGNAL_RULE_BOUNDS;
    const r = parseSignalRules(wrap({ peVsSector: { minPeers: b.minPeers.min, discountPpm: b.ratioPpm.max } }));
    expect(r.peVsSector).toMatchObject({ minPeers: 3, discountPpm: 1_000_000 });
  });
  test('minConsecutive > comparisons -> both default; shortDays >= longDays -> both default', () => {
    const g = parseSignalRules(wrap({ earningsGrowth: { comparisons: 2, minConsecutive: 3 } }));
    expect(g.earningsGrowth).toMatchObject({ comparisons: 4, minConsecutive: 2 });
    const ok = parseSignalRules(wrap({ earningsGrowth: { comparisons: 6, minConsecutive: 3 } }));
    expect(ok.earningsGrowth).toMatchObject({ comparisons: 6, minConsecutive: 3 });
    const m = parseSignalRules(wrap({ priceVsMa: { shortDays: 100, longDays: 100 } }));
    expect(m.priceVsMa).toMatchObject({ shortDays: 50, longDays: 200 });
  });
  test('other rule_configs keys (market) ignored', () => {
    expect(parseSignalRules({ market: { lotSize: 10 }, signals: { long: {} } })).toEqual(DEFAULT_SIGNAL_RULES);
  });
});
