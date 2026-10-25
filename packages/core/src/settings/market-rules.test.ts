import { describe, expect, it } from 'vitest';
import { DEFAULT_TRADING_RULES } from '../entry/rules';
import { DEFAULT_MARKET_RULES, mergeRuleConfigs, parseMarketRules } from './market-rules';

describe('parseMarketRules', () => {
  it('falls back to defaults for non-objects and empty objects', () => {
    for (const j of [{}, null, [], 'x']) expect(parseMarketRules(j)).toEqual(DEFAULT_MARKET_RULES);
  });
  it('reads a partial config and keeps default limits', () => {
    expect(parseMarketRules({ market: { lotSize: 10 } })).toEqual({ ...DEFAULT_MARKET_RULES, lotSize: 10 });
  });
  it('falls back per key on wrong types', () => {
    for (const lotSize of ['10', 0, -5, 1.5]) {
      expect(parseMarketRules({ market: { lotSize, priceLimitPpm: { HOSE: 50000 } } })).toEqual({
        lotSize: 100,
        priceLimitPpm: { ...DEFAULT_MARKET_RULES.priceLimitPpm, HOSE: 50000 },
      });
    }
    expect(parseMarketRules({ market: { priceLimitPpm: { HOSE: '7' } } })).toEqual(DEFAULT_MARKET_RULES);
  });
});

describe('mergeRuleConfigs', () => {
  const rules = { lotSize: 10, priceLimitPpm: { HOSE: 60000, HNX: 90000, UPCOM: 140000 } };
  it('preserves unknown keys', () => {
    const existing = {
      signals: { rsi: 14 },
      other: 1,
      market: { extra: true, lotSize: 100, priceLimitPpm: { HOSE: 1, HNX: 1, UPCOM: 1, XYZ: 5 } },
    };
    expect(mergeRuleConfigs(existing, rules)).toEqual({
      signals: { rsi: 14 },
      other: 1,
      market: { extra: true, lotSize: 10, priceLimitPpm: { HOSE: 60000, HNX: 90000, UPCOM: 140000, XYZ: 5 } },
    });
  });
  it('wraps a non-object existing value', () => {
    expect(mergeRuleConfigs(null, rules)).toEqual({ market: rules });
    expect(mergeRuleConfigs([1], rules)).toEqual({ market: rules });
  });
  it('round-trips through parseMarketRules', () => {
    expect(parseMarketRules(mergeRuleConfigs({}, rules))).toEqual(rules);
  });
});

it('DEFAULT_TRADING_RULES.lotSize equals DEFAULT_MARKET_RULES.lotSize', () => {
  expect(DEFAULT_TRADING_RULES.lotSize).toBe(DEFAULT_MARKET_RULES.lotSize);
});
