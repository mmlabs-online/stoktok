import { describe, expect, test } from 'vitest';
import { DEFAULT_SIGNAL_RULES } from './config';
import { LATEST_PERIOD, SIGNAL_DATE, closes, fin, quarters } from './fixtures';
import {
  checkFinancials,
  checkLatestPrice,
  checkPriceWindow,
  finalizeResult,
  gapOverlaps,
  medianInt,
  requiredQuarters,
  resolveEpsBasis,
  resolveSignalDate,
  safeRatioPpm,
  ttmEps,
  vnDayBounds,
} from './inputs';
import type { GapRef } from './types';

describe('resolveSignalDate', () => {
  test('data date = expected -> that date; older -> expected; newer -> data date; none -> expected', () => {
    expect(resolveSignalDate('2026-10-23', ['2026-10-23'])).toBe('2026-10-23');
    expect(resolveSignalDate('2026-10-23', ['2026-10-22', '2026-10-21'])).toBe('2026-10-23');
    expect(resolveSignalDate('2026-10-23', ['2026-10-22', '2026-10-26'])).toBe('2026-10-26');
    expect(resolveSignalDate('2026-10-23', [])).toBe('2026-10-23');
  });
  test('Saturday and Sunday re-runs (expected = Friday) -> Friday', () => {
    expect(resolveSignalDate('2026-10-23', ['2026-10-23'])).toBe('2026-10-23');
  });
});

describe('checkLatestPrice', () => {
  test('none -> price_missing; older -> price_stale; equal -> ok', () => {
    expect(checkLatestPrice([], SIGNAL_DATE).reasons).toEqual(['price_missing']);
    expect(checkLatestPrice(closes('A', '2026-10-23', 3), SIGNAL_DATE).reasons).toEqual(['price_stale']);
    expect(checkLatestPrice(closes('A', SIGNAL_DATE, 3), SIGNAL_DATE).reasons).toEqual([]);
  });
});

const win = (cs: ReturnType<typeof closes>, days: number, over: { holidays?: string[]; gaps?: GapRef[] } = {}) =>
  checkPriceWindow({ symbol: 'A', closes: cs, days, signalDate: SIGNAL_DATE, holidays: over.holidays ?? [], gaps: over.gaps ?? [] });

describe('checkPriceWindow', () => {
  test('N bars on N expected days -> ok', () => {
    const r = win(closes('A', SIGNAL_DATE, 10), 10);
    expect(r.reasons).toEqual([]);
    expect(r.window).toHaveLength(10);
  });
  test('N-1 stored -> insufficient_history', () => {
    expect(win(closes('A', SIGNAL_DATE, 9), 10).reasons).toEqual(['insufficient_history']);
  });
  test('N stored but a weekday missing -> price_gap with missingDates', () => {
    const cs = closes('A', SIGNAL_DATE, 11).filter((c) => c.tradeDate !== '2026-10-20');
    const r = win(cs, 10);
    expect(r.reasons).toEqual(['price_gap']);
    expect(r.missingDates).toEqual(['2026-10-20']);
    expect(r.window).toEqual([]);
  });
  test('configured holiday in window -> no gap; unconfigured holiday -> price_gap', () => {
    const cs = closes('A', SIGNAL_DATE, 11).filter((c) => c.tradeDate !== '2026-10-20');
    expect(win(cs, 10, { holidays: ['2026-10-20'] }).reasons).toEqual([]);
    expect(win(cs, 10).reasons).toEqual(['price_gap']);
  });
  test('open gap (symbol) or market-wide overlapping -> price_gap_recorded; outside window -> ok', () => {
    const cs = closes('A', SIGNAL_DATE, 10);
    const g = (symbol: string | null, fromTs: string, toTs: string): GapRef => ({ id: 1, symbol, fromTs, toTs });
    expect(win(cs, 10, { gaps: [g('A', '2026-10-20T00:00:00Z', '2026-10-20T05:00:00Z')] }).reasons).toEqual(['price_gap_recorded']);
    expect(win(cs, 10, { gaps: [g(null, '2026-10-20T00:00:00Z', '2026-10-20T05:00:00Z')] }).reasons).toEqual(['price_gap_recorded']);
    expect(win(cs, 10, { gaps: [g('A', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')] }).reasons).toEqual([]);
    expect(win(cs, 10, { gaps: [g('B', '2026-10-20T00:00:00Z', '2026-10-20T05:00:00Z')] }).reasons).toEqual([]);
  });
  test('gapOverlaps and vnDayBounds use VN days', () => {
    const b = vnDayBounds('2026-10-20', '2026-10-20');
    expect(gapOverlaps({ fromTs: '2026-10-19T17:00:00Z', toTs: '2026-10-19T17:00:00Z' }, b)).toBe(true);
    expect(gapOverlaps({ fromTs: '2026-10-20T17:00:00Z', toTs: '2026-10-21T00:00:00Z' }, b)).toBe(false);
  });
});

const finCheck = (rows: ReturnType<typeof quarters>, over: { required?: number; gaps?: GapRef[]; signalDate?: string } = {}) =>
  checkFinancials({
    symbol: 'A',
    rows,
    required: over.required ?? 4,
    signalDate: over.signalDate ?? SIGNAL_DATE,
    publishLagDays: 45,
    gaps: over.gaps ?? [],
    maxFetchAgeDays: 7,
  });

describe('checkFinancials', () => {
  test('ok with 4 consecutive quarters ending at the latest expected one', () => {
    const r = finCheck(quarters('A', LATEST_PERIOD, 4));
    expect(r.reasons).toEqual([]);
    expect(r.rows.map((x) => x.period)).toEqual(['2025Q3', '2025Q4', '2026Q1', '2026Q2']);
  });
  test('no rows -> financials_missing', () => {
    expect(finCheck([]).reasons).toEqual(['financials_missing']);
  });
  test('latest < latestExpectedPeriod -> financials_stale', () => {
    expect(finCheck(quarters('A', '2026Q1', 4)).reasons).toEqual(['financials_stale']);
  });
  test('missing middle quarter or only 3 of 4 -> financials_gap', () => {
    const rows = quarters('A', LATEST_PERIOD, 4).filter((r) => r.period !== '2025Q4');
    const r = finCheck(rows);
    expect(r.reasons).toEqual(['financials_gap']);
    expect(r.missingPeriods).toEqual(['2025Q4']);
    expect(finCheck(quarters('A', LATEST_PERIOD, 3)).reasons).toEqual(['financials_gap']);
  });
  test('open financials gap (symbol or market-wide) -> financials_gap_recorded', () => {
    const rows = quarters('A', LATEST_PERIOD, 4);
    const from = '2025-12-31T17:00:00.000Z';
    const to = '2026-03-31T16:59:59.000Z';
    expect(finCheck(rows, { gaps: [{ id: 1, symbol: 'A', fromTs: from, toTs: to }] }).reasons).toEqual(['financials_gap_recorded']);
    expect(finCheck(rows, { gaps: [{ id: 1, symbol: null, fromTs: from, toTs: to }] }).reasons).toEqual(['financials_gap_recorded']);
    expect(finCheck(rows, { gaps: [{ id: 1, symbol: 'B', fromTs: from, toTs: to }] }).reasons).toEqual([]);
  });
  test('fetchedAt older than max age -> financials_fetch_stale', () => {
    const rows = quarters('A', LATEST_PERIOD, 4, (i) => (i === 3 ? { fetchedAt: '2026-10-10T00:00:00.000Z' } : {}));
    expect(finCheck(rows).reasons).toEqual(['financials_fetch_stale']);
  });
  test('requiredQuarters per rule and basis', () => {
    const r = DEFAULT_SIGNAL_RULES;
    expect(requiredQuarters('pe', 'quarterly', r)).toBe(4);
    expect(requiredQuarters('pe', 'unverified', r)).toBe(4);
    expect(requiredQuarters('pe', 'ttm', r)).toBe(1);
    expect(requiredQuarters('pb', 'quarterly', r)).toBe(1);
    expect(requiredQuarters('growth', 'unverified', r)).toBe(8);
  });
});

describe('eps basis', () => {
  const rows = quarters('A', LATEST_PERIOD, 4, (i) => ({ eps: 100 * (i + 1) }));
  test('same rows give quarterly = sum of 4, ttm = latest, unverified = null', () => {
    expect(ttmEps(rows, 'quarterly')).toBe(1000);
    expect(ttmEps(rows, 'ttm')).toBe(400);
    expect(ttmEps(rows, 'unverified')).toBeNull();
    expect(ttmEps(rows.slice(1), 'quarterly')).toBeNull();
  });
  test('resolveEpsBasis: declared if all agree; mixed or unknown source -> unverified', () => {
    expect(resolveEpsBasis(rows, { 'fake-fin': 'ttm' })).toBe('ttm');
    expect(resolveEpsBasis(rows, {})).toBe('unverified');
    expect(resolveEpsBasis([fin('A', '2026Q1'), fin('A', '2026Q2', { source: 'other' })], { 'fake-fin': 'ttm', other: 'quarterly' })).toBe('unverified');
  });
});

describe('integer helpers', () => {
  test('medianInt odd, even (half-up), empty', () => {
    expect(medianInt([3, 1, 2])).toBe(2);
    expect(medianInt([1, 2])).toBe(2);
    expect(medianInt([1, 4, 2, 3])).toBe(3);
    expect(medianInt([-1, -2])).toBe(-2);
    expect(medianInt([])).toBeNull();
  });
  test('safeRatioPpm: ratio, non-positive denominator and overflow -> null', () => {
    expect(safeRatioPpm(15_000, 1000)).toBe(15_000_000);
    expect(safeRatioPpm(1, 0)).toBeNull();
    expect(safeRatioPpm(Number.MAX_SAFE_INTEGER, 1)).toBeNull();
  });
});

describe('finalizeResult', () => {
  const base = { symbol: 'A', ruleId: 'r', signalDate: SIGNAL_DATE, inputs: {} };
  test('reasons sorted by REASON_ORDER; data reason -> dataFresh false; rule reason only -> true', () => {
    const r = finalizeResult({ ...base, reasons: ['peers_insufficient', 'price_stale', 'price_stale'], label: null, value: null });
    expect(r).toMatchObject({ status: 'suppressed', label: null, value: null, dataFresh: false, reasons: ['price_stale', 'peers_insufficient'] });
    expect(finalizeResult({ ...base, reasons: ['eps_non_positive'], label: null, value: null }).dataFresh).toBe(true);
  });
  test('ok needs label and value', () => {
    expect(finalizeResult({ ...base, reasons: [], label: 'neutral', value: 0 })).toMatchObject({ status: 'ok', dataFresh: true, reasons: [] });
    expect(() => finalizeResult({ ...base, reasons: [], label: null, value: null })).toThrow(RangeError);
  });
});
