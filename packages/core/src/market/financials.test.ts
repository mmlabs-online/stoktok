import { describe, expect, test } from 'vitest';
import { DEFAULT_FINANCIALS_SANITY as S } from './config';
import { normalizeQuarterlyFinancials, normalizeSectorLabel, toVndAmount } from './financials';

const units = { perShare: 'VND', totals: 'BILLION_VND' } as const;
const good = { year: 2026, quarter: 3, eps: 1500, bvps: 25300, revenue: 1234.567, netIncome: 98.5 };
const norm = (over: Record<string, unknown> = {}) => normalizeQuarterlyFinancials('TSTA', { ...good, ...over }, units, S);

describe('toVndAmount', () => {
  test('VND: integer passes, decimal rounds half away from zero (2.5->3, -2.5->-3)', () => {
    expect(toVndAmount(1500, 'VND')).toBe(1500);
    expect(toVndAmount(2.5, 'VND')).toBe(3);
    expect(toVndAmount(-2.5, 'VND')).toBe(-3);
    expect(toVndAmount(-0.2, 'VND')).toBe(0);
    expect(Object.is(toVndAmount(-0.2, 'VND'), 0)).toBe(true);
  });
  test('BILLION_VND: 1234.567 -> 1_234_567_000_000; 0.0000000004 -> 0; non-safe result -> null', () => {
    expect(toVndAmount(1234.567, 'BILLION_VND')).toBe(1_234_567_000_000);
    expect(toVndAmount(0.0000000004, 'BILLION_VND')).toBe(0);
    expect(toVndAmount(1e12, 'BILLION_VND')).toBeNull();
  });
  test('rejects NaN, Infinity, string, null, undefined, boolean', () => {
    for (const v of [NaN, Infinity, -Infinity, '1', null, undefined, true]) {
      expect(toVndAmount(v, 'VND')).toBeNull();
    }
  });
});

describe('normalizeQuarterlyFinancials', () => {
  test('valid period returns integers + period 2026Q3', () => {
    expect(norm()).toEqual({
      ok: true,
      value: { symbol: 'TSTA', period: '2026Q3', eps: 1500, bvps: 25300, revenue: 1_234_567_000_000, netIncome: 98_500_000_000 },
    });
  });
  test('negative eps, negative net_income, negative bvps (abs >= min) accepted', () => {
    expect(norm({ eps: -200, netIncome: -5, bvps: -25300 })).toMatchObject({ ok: true, value: { eps: -200, bvps: -25300, netIncome: -5_000_000_000 } });
  });
  test('missing_* each reject the whole period and carry the period', () => {
    for (const [key, reason] of [
      ['eps', 'missing_eps'],
      ['bvps', 'missing_bvps'],
      ['revenue', 'missing_revenue'],
      ['netIncome', 'missing_net_income'],
    ] as const) {
      expect(norm({ [key]: null })).toEqual({ ok: false, reason, period: '2026Q3' });
      expect(norm({ [key]: undefined })).toEqual({ ok: false, reason, period: '2026Q3' });
    }
  });
  test('invalid_period for quarter 0, 5, 2.5, "3", year 1989 / 2101 (no period carried)', () => {
    for (const over of [{ quarter: 0 }, { quarter: 5 }, { quarter: 2.5 }, { quarter: '3' }, { year: 1989 }, { year: 2101 }]) {
      expect(norm(over)).toEqual({ ok: false, reason: 'invalid_period' });
    }
  });
  test('negative_revenue; revenue below min non-zero -> revenue_out_of_band; revenue 0 accepted', () => {
    expect(norm({ revenue: -1 })).toMatchObject({ ok: false, reason: 'negative_revenue' });
    expect(norm({ revenue: 0.0001 })).toMatchObject({ ok: false, reason: 'revenue_out_of_band' });
    expect(norm({ revenue: 0 })).toMatchObject({ ok: true, value: { revenue: 0 } });
  });
  test('rejectZeroRevenue: revenue 0 -> zero_revenue', () => {
    const raw = { year: 2026, quarter: 3, eps: 1500, bvps: 25300, revenue: 0, netIncome: 98.5 };
    const units = { perShare: 'VND', totals: 'BILLION_VND' } as const;
    expect(normalizeQuarterlyFinancials('TSTA', raw, units, { ...S, rejectZeroRevenue: true })).toEqual({ ok: false, reason: 'zero_revenue', period: '2026Q3' });
  });
  test('rejectZeroRevenue unset: revenue 0 still accepted (TCBS unchanged)', () => {
    expect(norm({ revenue: 0 })).toMatchObject({ ok: true, value: { revenue: 0 } });
    expect(S.rejectZeroRevenue).toBeUndefined();
  });
  test('wrong unit per-share: bvps 25.3 (thousand VND) -> bvps_out_of_band', () => {
    expect(norm({ bvps: 25.3 })).toMatchObject({ ok: false, reason: 'bvps_out_of_band', period: '2026Q3' });
  });
  test('wrong unit totals: raw-VND revenue declared BILLION_VND -> invalid_revenue', () => {
    expect(norm({ revenue: 1_234_567_000_000 })).toMatchObject({ ok: false, reason: 'invalid_revenue' });
  });
  test('eps beyond maxAbsEpsVnd -> eps_out_of_band; net_income beyond maxAbsTotalVnd -> net_income_out_of_band', () => {
    expect(norm({ eps: 2_000_000 })).toMatchObject({ ok: false, reason: 'eps_out_of_band' });
    expect(norm({ netIncome: 2_000_000 })).toMatchObject({ ok: false, reason: 'net_income_out_of_band' });
  });
});

describe('normalizeSectorLabel', () => {
  test('trims, collapses whitespace; empty, whitespace, non-string, >100 chars -> null', () => {
    expect(normalizeSectorLabel('  Thực phẩm   và  đồ uống ')).toBe('Thực phẩm và đồ uống');
    for (const v of ['', '   ', 5, null, undefined, 'x'.repeat(101)]) expect(normalizeSectorLabel(v)).toBeNull();
    expect(normalizeSectorLabel('x'.repeat(100))).toHaveLength(100);
  });
});
