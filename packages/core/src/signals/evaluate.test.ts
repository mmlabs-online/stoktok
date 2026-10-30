import { describe, expect, test } from 'vitest';
import { DEFAULT_MARKET_RULES } from '../settings/market-rules';
import { DEFAULT_SIGNAL_RULES } from './config';
import { evaluateMediumSignals } from './evaluate';
import type { EvaluateInput } from './evaluate';
import { LATEST_PERIOD, SIGNAL_DATE, closes, quarters, symbolData, tradingDates } from './fixtures';
import { DATA_REASONS } from './types';

function input(over: Partial<EvaluateInput> = {}): EvaluateInput {
  const syms = ['A', 'B', 'C', 'D', 'E', 'F'];
  const data = Object.fromEntries(syms.map((s) => [s, symbolData(s)]));
  return {
    signalDate: SIGNAL_DATE,
    holidays: [],
    rules: DEFAULT_SIGNAL_RULES,
    publishLagDays: 45,
    symbols: syms,
    closes: Object.fromEntries(syms.map((s) => [s, (data[s] as ReturnType<typeof symbolData>).closes])),
    financials: syms.flatMap((s) => quarters(s, LATEST_PERIOD, 8)),
    sectors: Object.fromEntries(syms.map((s) => [s, (data[s] as ReturnType<typeof symbolData>).sector])),
    priceGaps: [],
    financialsGaps: [],
    epsBasisBySource: { 'fake-fin': 'quarterly' },
    exchanges: {},
    corporateActions: [],
    marketRules: { priceLimitPpm: DEFAULT_MARKET_RULES.priceLimitPpm },
    ...over,
  };
}

describe('evaluateMediumSignals', () => {
  test('emits one result per (symbol, enabled rule), sorted; disabled rule -> no result', () => {
    const r = evaluateMediumSignals(input());
    expect(r).toHaveLength(6 * 5);
    expect(r.slice(0, 5).map((x) => x.ruleId)).toEqual(['earnings_growth_trend', 'pb_vs_sector', 'pe_vs_sector', 'price_vs_ma_200', 'price_vs_ma_50']);
    expect(r.every((x) => x.horizon === 'medium' && x.signalDate === SIGNAL_DATE)).toBe(true);
    const off = { ...DEFAULT_SIGNAL_RULES, peVsSector: { ...DEFAULT_SIGNAL_RULES.peVsSector, enabled: false }, priceVsMa: { ...DEFAULT_SIGNAL_RULES.priceVsMa, enabled: false } };
    const fewer = evaluateMediumSignals(input({ rules: off }));
    expect(fewer.map((x) => x.ruleId)).not.toContain('pe_vs_sector');
    expect(fewer.filter((x) => x.symbol === 'A')).toHaveLength(2);
  });
  test('uses configured MA periods in rule ids', () => {
    const rules = { ...DEFAULT_SIGNAL_RULES, priceVsMa: { ...DEFAULT_SIGNAL_RULES.priceVsMa, shortDays: 20, longDays: 100 } };
    expect(evaluateMediumSignals(input({ rules })).map((x) => x.ruleId)).toContain('price_vs_ma_20');
  });
  test('deterministic: two calls deep-equal; every value is a safe integer or null', () => {
    const a = evaluateMediumSignals(input());
    expect(evaluateMediumSignals(input())).toEqual(a);
    for (const x of a) expect(x.value === null || Number.isSafeInteger(x.value)).toBe(true);
  });
  test('ok rows exist: P/E, P/B and growth ok with 5 peers, MA suppressed with 3 bars', () => {
    const a = evaluateMediumSignals(input()).filter((x) => x.symbol === 'A');
    expect(a.filter((x) => x.status === 'ok').map((x) => x.ruleId)).toEqual(['earnings_growth_trend', 'pb_vs_sector', 'pe_vs_sector']);
    expect(a.find((x) => x.ruleId === 'price_vs_ma_200')?.reasons).toContain('insufficient_history');
  });
  test('snapshot lists refs with source and fetchedAt, params and epsBasis', () => {
    const pe = evaluateMediumSignals(input()).find((x) => x.symbol === 'A' && x.ruleId === 'pe_vs_sector');
    const refs = pe?.inputs.refs as { ref: string; source?: string; fetchedAt?: string }[];
    expect(refs.map((r) => r.ref)).toEqual([
      `prices_daily:A:${SIGNAL_DATE}`,
      'financials:A:2025Q3', 'financials:A:2025Q4', 'financials:A:2026Q1', 'financials:A:2026Q2',
      'symbols:A:sector',
    ]);
    for (const r of refs) expect(r.source && r.fetchedAt).toBeTruthy();
    expect(pe?.inputs).toMatchObject({ params: DEFAULT_SIGNAL_RULES.peVsSector, epsBasis: 'quarterly' });
    const ma = evaluateMediumSignals(input({ closes: { A: closes('A', SIGNAL_DATE, 60) } })).find((x) => x.symbol === 'A' && x.ruleId === 'price_vs_ma_50');
    expect(ma?.status).toBe('ok');
    expect(ma?.inputs.window).toMatchObject({ count: 50 });
  });
  test('a recorded gap is cited as data_gaps:id', () => {
    const gaps = [{ id: 7, symbol: null, fromTs: '2026-10-22T00:00:00Z', toTs: '2026-10-22T05:00:00Z' }];
    const ma = evaluateMediumSignals(input({ closes: { A: closes('A', SIGNAL_DATE, 60) }, priceGaps: gaps })).find((x) => x.symbol === 'A' && x.ruleId === 'price_vs_ma_50');
    expect(ma?.status).toBe('suppressed');
    expect(ma?.reasons).toEqual(['price_gap_recorded']);
    expect((ma?.inputs.refs as { ref: string }[]).map((r) => r.ref)).toContain('data_gaps:7');
  });
  test('dataFresh false iff a data reason is present; ok => reasons [] with label and value', () => {
    for (const x of evaluateMediumSignals(input({ epsBasisBySource: {} }))) {
      expect(x.dataFresh).toBe(!x.reasons.some((r) => (DATA_REASONS as readonly string[]).includes(r)));
      if (x.status === 'ok') {
        expect(x.reasons).toEqual([]);
        expect(x.label).not.toBeNull();
        expect(x.value).not.toBeNull();
      } else {
        expect(x.label).toBeNull();
        expect(x.value).toBeNull();
        expect(x.reasons.length).toBeGreaterThan(0);
      }
    }
  });
  test('symbol without any stored data is suppressed, not skipped', () => {
    const r = evaluateMediumSignals(input({ symbols: ['ZZZ'], closes: {}, financials: [], sectors: {} }));
    expect(r).toHaveLength(5);
    expect(r.every((x) => x.status === 'suppressed')).toBe(true);
    expect(r.find((x) => x.ruleId === 'pe_vs_sector')?.reasons).toEqual(['price_missing', 'financials_missing', 'sector_missing']);
  });
  test('corporateActions and exchanges are routed per symbol: only the symbol with a stock dividend is suppressed', () => {
    const full = (s: string) => closes(s, SIGNAL_DATE, 60);
    const stock = { type: 'stock_dividend' as const, id: 'sd1', symbol: 'A', exDate: tradingDates(SIGNAL_DATE, 10)[0] as string, ratio: { held: 100, received: 20 } };
    const r = evaluateMediumSignals(
      input({ closes: { A: full('A'), B: full('B') }, symbols: ['A', 'B'], corporateActions: [stock], exchanges: { A: 'HOSE', B: 'HNX' } }),
    );
    const ma = (s: string) => r.find((x) => x.symbol === s && x.ruleId === 'price_vs_ma_50');
    expect(ma('A')).toMatchObject({ status: 'suppressed', reasons: ['corporate_action_in_window'] });
    expect(ma('B')).toMatchObject({ status: 'ok' });
    expect(ma('B')?.inputs.guard).toMatchObject({ exchange: 'HNX', exchangeUnknown: false });
  });
});
