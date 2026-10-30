import { describe, expect, test } from 'vitest';
import { DEFAULT_SIGNAL_RULES } from './config';
import { LATEST_PERIOD, closes, ctx, quarters, SIGNAL_DATE } from './fixtures';
import { earningsGrowthTrend } from './growth';
import type { SymbolData } from './types';

/** 8 quarters; net income per quarter index 0..7 (year-on-year pairs are i and i+4). */
function data(ni: number[], revenue = 1_000_000_000): SymbolData {
  return {
    closes: closes('A', SIGNAL_DATE, 1),
    financials: quarters('A', LATEST_PERIOD, ni.length, (i) => ({ netIncome: ni[i] as number, revenue })),
    sector: { sector: null, source: null, fetchedAt: null },
    exchange: 'HOSE',
    corporateActions: [],
  };
}
const M = 100_000_000;
const m = (x: number) => Math.round(x * M);
const run = (ni: number[], revenue?: number) => earningsGrowthTrend('A', data(ni, revenue), ctx());
const cls = (r: ReturnType<typeof run>) => (r.inputs.comparisons as { class: string }[]).map((c) => c.class);

describe('earningsGrowthTrend', () => {
  test('base>0: g >= threshold up, <= -threshold down, else flat (inclusive)', () => {
    // last 4 comparisons: current 110/90/105/100 vs base 100.
    const r = run([M, M, M, M, m(1.1), m(0.9), m(1.05), M]);
    expect(cls(r)).toEqual(['up', 'down', 'flat', 'flat']);
    expect((r.inputs.comparisons as { growthPpm: number }[]).map((c) => c.growthPpm)).toEqual([100_000, -100_000, 50_000, 0]);
  });
  test('base>0 -> current <=0 = to_loss (down); base <=0 -> current>0 turnaround (up, no %); both <=0 loss (down)', () => {
    const r = run([M, -M, -M, -M, -M, M, -m(2), 0]);
    expect(cls(r)).toEqual(['to_loss', 'turnaround', 'loss', 'loss']);
    expect((r.inputs.comparisons as { growthPpm: number | null }[]).map((c) => c.growthPpm)).toEqual([null, null, null, null]);
  });
  test('tiny positive base below minBasePpmOfRevenue treated as non-positive', () => {
    // revenue 1e9, 1% = 1e7; base 1e6 is tiny.
    const r = run([1_000_000, M, M, M, m(5), M, M, M]);
    expect(cls(r)[0]).toBe('turnaround');
  });
  test('last minConsecutive up -> bullish, value +streak; down -> bearish, value -streak; flat breaks streak', () => {
    const up = run([M, M, M, M, m(0.8), m(0.8), m(2), m(2)]);
    expect(up).toMatchObject({ status: 'ok', label: 'bullish', value: 2 });
    const down = run([M, M, M, M, M, M, m(0.5), m(0.5)]);
    expect(down).toMatchObject({ label: 'bearish', value: -2 });
    const flat = run([M, M, M, M, m(2), m(2), m(2), M]);
    expect(flat).toMatchObject({ label: 'neutral', value: 0 });
    const one = run([M, M, M, M, M, M, M, m(2)]);
    expect(one).toMatchObject({ label: 'neutral', value: 1 });
  });
  test('fewer than comparisons+4 quarters -> financials_gap; missing latest -> financials_stale', () => {
    const few = earningsGrowthTrend('A', data([M, M, M, M, M, M, M]), ctx());
    expect(few).toMatchObject({ status: 'suppressed', reasons: ['financials_gap'], dataFresh: false });
    const d = data([M, M, M, M, M, M, M, M, M]);
    d.financials = d.financials.slice(0, -1);
    expect(earningsGrowthTrend('A', d, ctx()).reasons).toEqual(['financials_stale']);
  });
  test('params and comparisons in snapshot; custom comparisons respected', () => {
    const rules = { ...DEFAULT_SIGNAL_RULES, earningsGrowth: { ...DEFAULT_SIGNAL_RULES.earningsGrowth, comparisons: 2, minConsecutive: 1 } };
    const r = earningsGrowthTrend('A', data([M, M, M, M, m(2), m(2)]), ctx({ rules }));
    expect(r.inputs).toMatchObject({ params: rules.earningsGrowth });
    expect(r.inputs.comparisons).toHaveLength(2);
    expect(r.label).toBe('bullish');
  });
});
