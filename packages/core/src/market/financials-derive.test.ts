import { describe, expect, test } from 'vitest';
import { deriveVciIqQuarter } from './financials-derive';

const ni = (entries: Record<string, number>) => new Map(Object.entries(entries));
const FOUR = ni({ '2025Q4': 1000, '2026Q1': 2000, '2026Q2': 3000, '2026Q3': 4001 });
const base = { period: '2026Q3', netIncomeByPeriod: FOUR, equity: 1_000_000, minority: 0, shares: 100 };

describe('deriveVciIqQuarter', () => {
  test("TTM EPS = sum of 4 consecutive quarters' parent NI / period shares, rounded half away from zero", () => {
    // 10001 / 100 = 100.01 -> 100
    expect(deriveVciIqQuarter(base).eps).toBe(100);
    // 10050 / 100 = 100.5 -> 101
    expect(deriveVciIqQuarter({ ...base, netIncomeByPeriod: ni({ '2025Q4': 1000, '2026Q1': 2000, '2026Q2': 3000, '2026Q3': 4050 }) }).eps).toBe(101);
  });
  test('negative TTM NI gives negative EPS; rounding is symmetric', () => {
    const neg = (v: number) => ni({ '2025Q4': 0, '2026Q1': 0, '2026Q2': 0, '2026Q3': v });
    expect(deriveVciIqQuarter({ ...base, netIncomeByPeriod: neg(-10050) }).eps).toBe(-101);
    expect(deriveVciIqQuarter({ ...base, netIncomeByPeriod: neg(-10049) }).eps).toBe(-100);
  });
  test('missing one of the 4 quarters -> eps missing (no fill, no partial sum)', () => {
    const m = ni({ '2025Q4': 1000, '2026Q2': 3000, '2026Q3': 4001 });
    const out = deriveVciIqQuarter({ ...base, netIncomeByPeriod: m });
    expect(out.eps).toBeUndefined();
    expect(out.bvps).toBe(10_000);
  });
  test('non-consecutive quarters across a year boundary (Q4 missing) -> eps missing', () => {
    const m = ni({ '2025Q3': 1000, '2026Q1': 2000, '2026Q2': 3000, '2026Q3': 4001 });
    expect(deriveVciIqQuarter({ ...base, netIncomeByPeriod: m }).eps).toBeUndefined();
  });
  test("share issue inside the window: all 4 quarters / the current period's shares (retroactive)", () => {
    const out = deriveVciIqQuarter({ ...base, netIncomeByPeriod: ni({ '2025Q4': 4000, '2026Q1': 4000, '2026Q2': 4000, '2026Q3': 4000 }), shares: 200 });
    expect(out.eps).toBe(80);
  });
  test('BVPS = (bsa78 - bsa210) / period shares (HPG 2026 Q3 values -> about 17,624)', () => {
    const out = deriveVciIqQuarter({ ...base, equity: 149_568_352_619_326, minority: 772_935_036_121, shares: 8_442_964_520 });
    expect(out.bvps).toBe(17_624);
  });
  test('missing / zero / non-integer / negative shares -> reason', () => {
    expect(deriveVciIqQuarter({ ...base, shares: undefined })).toEqual({ reason: 'missing_shares' });
    expect(deriveVciIqQuarter({ ...base, shares: null })).toEqual({ reason: 'missing_shares' });
    for (const shares of [0, -5, 1.5, '100', Number.NaN]) {
      expect(deriveVciIqQuarter({ ...base, shares })).toEqual({ reason: 'invalid_shares' });
    }
  });
  test('missing equity or minority value -> bvps missing (not treated as 0)', () => {
    expect(deriveVciIqQuarter({ ...base, minority: undefined }).bvps).toBeUndefined();
    expect(deriveVciIqQuarter({ ...base, equity: undefined }).bvps).toBeUndefined();
    expect(deriveVciIqQuarter({ ...base, minority: undefined }).eps).toBe(100);
  });
  test('amounts beyond safe integer -> invalid_amount', () => {
    expect(deriveVciIqQuarter({ ...base, equity: 2 ** 60 })).toEqual({ reason: 'invalid_amount' });
    const big = ni({ '2025Q4': 2 ** 52, '2026Q1': 2 ** 52, '2026Q2': 2 ** 52, '2026Q3': 2 ** 52 });
    expect(deriveVciIqQuarter({ ...base, netIncomeByPeriod: big, shares: 1 })).toEqual({ reason: 'invalid_amount' });
  });
});
