import { describe, expect, it } from 'vitest';
import { entryMessage } from '../entry/messages-vi';
import { DEFAULT_SIGNAL_RULES, SIGNAL_RULE_BOUNDS, parseSignalRules } from '../signals/config';
import { mergeSignalRules, signalRulesToFormValues, validateSignalRulesInput } from './signal-rules-form';
import type { SignalRulesField, SignalRulesFormRaw } from './signal-rules-form';

const base = signalRulesToFormValues(DEFAULT_SIGNAL_RULES);
const run = (o: Partial<SignalRulesFormRaw>) => validateSignalRulesInput({ ...base, ...o });
const errorOf = (o: Partial<SignalRulesFormRaw>, f: SignalRulesField) => {
  const r = run(o);
  return r.ok ? undefined : r.errors[f];
};
const B = SIGNAL_RULE_BOUNDS;

describe('validateSignalRulesInput', () => {
  it('valid raw gives SignalRules with ppm integers', () => {
    const r = run({ peDiscount: '0,5', pePremium: '2', growthMinBase: '1', peMinPeers: '8', pbEnabled: '' });
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.peVsSector).toEqual({ enabled: true, minPeers: 8, discountPpm: 5000, premiumPpm: 20000 });
    expect(r.value.pbVsSector.enabled).toBe(false);
    expect(r.value.earningsGrowth.minBasePpmOfRevenue).toBe(10000);
    expect(r.value.priceVsMa.neutralBandPpm).toBe(20000);
  });

  it('defaults round-trip through the form', () => {
    expect(run({})).toEqual({ ok: true, value: DEFAULT_SIGNAL_RULES });
    expect(base.peDiscount).toBe('20');
    expect(base.maNeutralBand).toBe('2');
  });

  it('bounds come from SIGNAL_RULE_BOUNDS (inclusive)', () => {
    const ints: [SignalRulesField, { min: number; max: number }][] = [
      ['peMinPeers', B.minPeers],
      ['pbMinPeers', B.minPeers],
      ['growthComparisons', B.comparisons],
      ['financialsMaxFetchAgeDays', B.maxFetchAgeDays],
    ];
    for (const [f, b] of ints) {
      expect(errorOf({ [f]: String(b.min) }, f)).toBeUndefined();
      expect(errorOf({ [f]: String(b.max) }, f)).toBeUndefined();
      expect(errorOf({ [f]: String(b.min - 1) }, f)?.code).toBe('OUT_OF_RANGE');
      expect(errorOf({ [f]: String(b.max + 1) }, f)?.code).toBe('OUT_OF_RANGE');
    }
    expect(errorOf({ peMinPeers: '2' }, 'peMinPeers')?.params).toEqual({ min: '3', max: '50' });
    const pcts: [SignalRulesField, { min: number; max: number }, string][] = [
      ['peDiscount', B.ratioPpm, '100'],
      ['growthThreshold', B.ratioPpm, '100'],
      ['maNeutralBand', B.neutralBandPpm, '20'],
    ];
    for (const [f, b, max] of pcts) {
      expect(errorOf({ [f]: '0' }, f)).toBeUndefined();
      expect(errorOf({ [f]: max }, f)).toBeUndefined();
      expect(errorOf({ [f]: `${max},0001` }, f)?.code).toBe('OUT_OF_RANGE');
      expect(b.min).toBe(0);
    }
    expect(errorOf({ maNeutralBand: '21' }, 'maNeutralBand')?.params).toEqual({ min: '0%', max: '20%' });
    expect(errorOf({ maShortDays: '4' }, 'maShortDays')?.params).toEqual({ min: '5', max: '250' });
  });

  it('parse failures map to existing codes', () => {
    expect(errorOf({ peMinPeers: 'abc' }, 'peMinPeers')?.code).toBe('WHOLE_NUMBER_INVALID');
    expect(errorOf({ peDiscount: 'abc' }, 'peDiscount')?.code).toBe('PERCENT_INVALID');
    expect(errorOf({ peDiscount: '1,23456' }, 'peDiscount')?.code).toBe('PERCENT_TOO_PRECISE');
    expect(errorOf({ peDiscount: '' }, 'peDiscount')?.code).toBe('REQUIRED');
    expect(errorOf({ peDiscount: '-1' }, 'peDiscount')?.code).toBe('OUT_OF_RANGE');
  });

  it('minConsecutive above comparisons is a cross-field error on growthMinConsecutive', () => {
    expect(errorOf({ growthComparisons: '3', growthMinConsecutive: '4' }, 'growthMinConsecutive')?.code).toBe(
      'MIN_CONSECUTIVE_ABOVE_COMPARISONS',
    );
    expect(errorOf({ growthComparisons: '3', growthMinConsecutive: '3' }, 'growthMinConsecutive')).toBeUndefined();
    expect(errorOf({ growthMinConsecutive: '9' }, 'growthMinConsecutive')?.code).toBe('OUT_OF_RANGE');
  });

  it('short >= long is a cross-field error on maLongDays only', () => {
    for (const long of ['50', '40']) {
      const r = run({ maShortDays: '50', maLongDays: long });
      if (r.ok) throw new Error('expected failure');
      expect(r.errors.maLongDays?.code).toBe('MA_LONG_NOT_ABOVE_SHORT');
      expect(r.errors.maShortDays).toBeUndefined();
    }
    expect(run({ maShortDays: '50', maLongDays: '51' }).ok).toBe(true);
  });

  it('skips the cross-field check when either side is invalid', () => {
    const r = run({ maShortDays: 'x', maLongDays: '3' });
    if (r.ok) throw new Error('expected failure');
    expect(r.errors.maShortDays?.code).toBe('WHOLE_NUMBER_INVALID');
    expect(r.errors.maLongDays?.code).toBe('OUT_OF_RANGE');
  });

  it('accepts exactly what parseSignalRules keeps', () => {
    const cases: Partial<SignalRulesFormRaw>[] = [
      { peMinPeers: '3', pbMinPeers: '3', growthComparisons: '1', growthMinConsecutive: '1', maShortDays: '5', maLongDays: '6', maNeutralBand: '0', peDiscount: '0', financialsMaxFetchAgeDays: '1' },
      { peMinPeers: '50', pbMinPeers: '50', growthComparisons: '8', growthMinConsecutive: '8', maShortDays: '249', maLongDays: '250', maNeutralBand: '20', pePremium: '100', financialsMaxFetchAgeDays: '90' },
    ];
    for (const c of cases) {
      const r = run(c);
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      expect(parseSignalRules(mergeSignalRules({}, r.value))).toEqual(r.value);
    }
  });

  it('new codes have Vietnamese text', () => {
    expect(entryMessage('MIN_CONSECUTIVE_ABOVE_COMPARISONS')).toBe('Không được lớn hơn số quý so sánh.');
    expect(entryMessage('MA_LONG_NOT_ABOVE_SHORT')).toBe('MA dài phải lớn hơn MA ngắn.');
  });
});

describe('mergeSignalRules', () => {
  it('keeps market, other horizons and unknown keys', () => {
    const existing = {
      market: { lotSize: 100 },
      signals: { long: { x: 1 }, medium: { extra: 1, priceVsMa: { legacy: 1, shortDays: 9 } } },
      other: 2,
    };
    const out = mergeSignalRules(existing, DEFAULT_SIGNAL_RULES) as {
      market: unknown;
      other: unknown;
      signals: { long: unknown; medium: { extra: unknown; priceVsMa: unknown } };
    };
    expect(out.market).toEqual({ lotSize: 100 });
    expect(out.other).toBe(2);
    expect(out.signals.long).toEqual({ x: 1 });
    expect(out.signals.medium.extra).toBe(1);
    expect(out.signals.medium.priceVsMa).toEqual({ ...DEFAULT_SIGNAL_RULES.priceVsMa, legacy: 1 });
    expect(parseSignalRules(out)).toEqual(DEFAULT_SIGNAL_RULES);
  });
  it('wraps a non-object existing value', () => {
    expect(mergeSignalRules(null, DEFAULT_SIGNAL_RULES)).toEqual({ signals: { medium: DEFAULT_SIGNAL_RULES } });
  });
});
