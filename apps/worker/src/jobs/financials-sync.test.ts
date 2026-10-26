import { addQuarters, latestExpectedPeriod, quarterBounds } from '@stoktok/core';
import type { QuarterlyFinancials, Result } from '@stoktok/core';
import type { DataGapInsert, FinancialInsert, FinancialRecord, OpenGapRecord } from '@stoktok/db';
import { describe, expect, test } from 'vitest';
import { FINANCIALS_SYNC_CONFIG } from '../config';
import type { FinancialsSource, QuarterlyResult } from '../sources/financials-source';
import { SourceError } from '../sources/price-source';
import { runFinancialsSync } from './financials-sync';
import type { FinancialsStore } from './financials-sync';

const NOW = new Date('2026-10-26T05:00:00Z'); // 12:00 VN; windowEnd 2026Q2 (Jun 30 + 45 d = Aug 14)
const END = latestExpectedPeriod('2026-10-26', 45);
const START = addQuarters(END, -11);

function memoryStore(opts: { watchlist?: string[]; held?: Result<string[]>; stored?: FinancialRecord[]; gaps?: OpenGapRecord[] } = {}) {
  const table = new Map<string, FinancialInsert>();
  for (const s of opts.stored ?? []) {
    table.set(`${s.symbol}|${s.period}`, { symbol: s.symbol, period: s.period, eps: s.eps, bvps: s.bvps, revenue: s.revenue, net_income: s.netIncome, source: s.source, fetched_at: s.fetchedAt });
  }
  const gaps: (OpenGapRecord & { resolvedAt?: string; row?: DataGapInsert })[] = [...(opts.gaps ?? [])];
  const sectors: Record<string, unknown> = {};
  let nextId = 100;
  const calls = { upsert: 0, insertGaps: 0, resolve: 0, sector: 0 };
  const store: FinancialsStore = {
    listWatchlistSymbols: async () => [...(opts.watchlist ?? [])],
    listHeldSymbols: async () => opts.held ?? { ok: true, value: [] },
    listFinancials: async (symbols, from) =>
      [...table.values()].filter((r) => symbols.includes(r.symbol) && r.period >= from).map((r) => ({
        symbol: r.symbol, period: r.period, eps: r.eps, bvps: r.bvps, revenue: r.revenue, netIncome: r.net_income, source: r.source, fetchedAt: r.fetched_at,
      })),
    upsertFinancials: async (rows) => {
      calls.upsert += 1;
      for (const r of rows) table.set(`${r.symbol}|${r.period}`, r);
      return rows.length;
    },
    listOpenGaps: async (symbols) => gaps.filter((g) => g.resolvedAt === undefined && g.symbol !== null && symbols.includes(g.symbol)),
    insertGaps: async (rows) => {
      calls.insertGaps += 1;
      for (const row of rows) gaps.push({ id: nextId++, symbol: row.symbol, fromTs: row.from_ts, toTs: row.to_ts, row });
    },
    resolveGaps: async (ids, at) => {
      calls.resolve += 1;
      for (const g of gaps) if (ids.includes(g.id)) g.resolvedAt = at;
    },
    setSymbolSector: async (symbol, v) => {
      calls.sector += 1;
      sectors[symbol] = v;
    },
  };
  return { store, table, gaps, sectors, calls };
}

const q = (symbol: string, period: string, eps = 1000): QuarterlyFinancials => ({ symbol, period, eps, bvps: 20000, revenue: 1_000_000_000_000, netIncome: 100_000_000_000 });
const rec = (symbol: string, period: string, eps = 1000): FinancialRecord => ({ ...q(symbol, period, eps), source: 'old', fetchedAt: '2026-01-01T00:00:00.000Z' });
const range = (from: string, to: string) => {
  const out: string[] = [];
  for (let p = from; p <= to; p = addQuarters(p, 1)) out.push(p);
  return out;
};

function fakeSource(impl: (symbol: string) => QuarterlyResult | Error, sector: (symbol: string) => string | null | Error = () => 'Sector') {
  const asked: string[] = [];
  const source: FinancialsSource = {
    name: 'fake-src',
    fetchQuarterly: async (symbol) => {
      asked.push(symbol);
      const r = impl(symbol);
      if (r instanceof Error) throw r;
      return r;
    },
    fetchSector: async (symbol) => {
      const r = sector(symbol);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { source, asked };
}
const periodsOf = (periods: string[], rejected: QuarterlyResult['rejected'] = []) => (symbol: string): QuarterlyResult => ({
  periods: periods.map((p) => q(symbol, p)),
  rejected,
});

function run(m: ReturnType<typeof memoryStore>, source: FinancialsSource, over: { dryRun?: boolean; config?: typeof FINANCIALS_SYNC_CONFIG; now?: Date } = {}) {
  const sleeps: number[] = [];
  const logs: string[] = [];
  return runFinancialsSync({
    store: m.store, source, now: over.now ?? NOW, config: over.config ?? FINANCIALS_SYNC_CONFIG, dryRun: over.dryRun ?? false,
    sleep: async (ms) => void sleeps.push(ms), log: (l) => void logs.push(l),
  }).then((summary) => ({ summary, sleeps, logs }));
}

describe('runFinancialsSync', () => {
  test('window comes from core: windowEnd 2026Q2, 12 quarters', async () => {
    const m = memoryStore({ watchlist: ['AAA'] });
    const { summary } = await run(m, fakeSource(periodsOf([])).source);
    expect([summary.windowStart, summary.windowEnd]).toEqual([START, '2026Q2']);
    expect(START).toBe('2023Q3');
  });
  test('every row carries source = source.name and fetched_at = now ISO', async () => {
    const m = memoryStore({ watchlist: ['AAA'] });
    await run(m, fakeSource(periodsOf(['2026Q1', '2026Q2'])).source);
    expect([...m.table.values()].map((r) => [r.source, r.fetched_at])).toEqual([['fake-src', NOW.toISOString()], ['fake-src', NOW.toISOString()]]);
  });
  test('re-run produces the same rows except fetched_at', async () => {
    const m = memoryStore({ watchlist: ['AAA'] });
    const { source } = fakeSource(periodsOf(['2026Q1', '2026Q2']));
    await run(m, source, { now: new Date('2026-10-26T05:00:00Z') });
    const first = [...m.table.values()];
    const { summary } = await run(m, source, { now: new Date('2026-10-26T06:00:00Z') });
    const second = [...m.table.values()];
    expect(second.map((r) => ({ ...r, fetched_at: '' }))).toEqual(first.map((r) => ({ ...r, fetched_at: '' })));
    expect(second[0]?.fetched_at).not.toBe(first[0]?.fetched_at);
    expect(summary.restated).toEqual([]);
  });
  test('only periods >= windowStart are upserted', async () => {
    const m = memoryStore({ watchlist: ['AAA'] });
    const { summary } = await run(m, fakeSource(periodsOf(['2023Q2', START, '2026Q2'])).source);
    expect([...m.table.values()].map((r) => r.period)).toEqual([START, '2026Q2']);
    expect(summary.periodsFetched).toBe(2);
  });
  test('interior missing period recorded once across two runs', async () => {
    const m = memoryStore({ watchlist: ['AAA'] });
    const { source } = fakeSource(periodsOf(['2025Q4', '2026Q2']));
    const a = await run(m, source);
    expect(a.summary.missingPeriods).toEqual({ AAA: ['2026Q1'] });
    expect(a.summary.gapsRecorded).toBe(1);
    expect(m.gaps[0]?.row).toMatchObject({ symbol: 'AAA', data_type: 'financials', source: 'fake-src', fetched_at: NOW.toISOString(), from_ts: quarterBounds('2026Q1').fromTs, to_ts: quarterBounds('2026Q1').toTs });
    const b = await run(m, source);
    expect(b.summary.gapsRecorded).toBe(0);
    expect(m.gaps).toHaveLength(1);
  });
  test('rejected period recorded as gap, no row written; stored period now rejected -> no gap, row untouched', async () => {
    const m = memoryStore({ watchlist: ['AAA', 'BBB'], stored: [rec('BBB', '2026Q1', 555)] });
    const { source } = fakeSource((s) =>
      s === 'AAA'
        ? { periods: [q(s, '2025Q4'), q(s, '2026Q2')], rejected: [{ period: '2026Q1', reason: 'eps_out_of_band' }] }
        : { periods: [q(s, '2026Q2')], rejected: [{ period: '2026Q1', reason: 'eps_out_of_band' }] });
    const { summary } = await run(m, source);
    expect(m.table.has('AAA|2026Q1')).toBe(false);
    expect(summary.missingPeriods).toEqual({ AAA: ['2026Q1'] });
    expect(m.table.get('BBB|2026Q1')?.eps).toBe(555);
    expect(summary.ok).toBe(false);
    expect(summary.rejected).toBe(2);
  });
  test('gap resolved when the period arrives', async () => {
    const b = quarterBounds('2026Q1');
    const m = memoryStore({ watchlist: ['AAA'], gaps: [{ id: 9, symbol: 'AAA', fromTs: b.fromTs, toTs: b.toTs }] });
    const { summary } = await run(m, fakeSource(periodsOf(['2025Q4', '2026Q1', '2026Q2'])).source);
    expect(summary.gapsResolved).toBe(1);
    expect(m.gaps[0]?.resolvedAt).toBe(NOW.toISOString());
  });
  test("no gap before the symbol's first known period; not-yet-due quarter is not a gap", async () => {
    const m = memoryStore({ watchlist: ['AAA'] });
    const { summary } = await run(m, fakeSource(periodsOf(['2025Q4', '2026Q1'])).source); // 2026Q2 missing but expected -> gap; 2026Q3 not due
    expect(summary.missingPeriods).toEqual({ AAA: ['2026Q2'] });
    const n = memoryStore({ watchlist: ['AAA'] });
    const out = await run(n, fakeSource(periodsOf(['2026Q1', '2026Q2', '2026Q3'])).source);
    expect(out.summary.missingPeriods).toEqual({});
    expect(range(START, END)).toHaveLength(12);
  });
  test('symbol with no data (ETF) -> symbolsWithoutData, no gaps, ok stays true', async () => {
    const m = memoryStore({ watchlist: ['ETF'] });
    const { summary } = await run(m, fakeSource(periodsOf([]), () => null).source);
    expect(summary.symbolsWithoutData).toEqual(['ETF']);
    expect(m.gaps).toHaveLength(0);
    expect(summary.ok).toBe(true);
    expect(summary.sectorMissing).toEqual(['ETF']);
  });
  test('restated values logged and listed; row overwritten', async () => {
    const m = memoryStore({ watchlist: ['AAA'], stored: [rec('AAA', '2026Q1', 900)] });
    const { summary, logs } = await run(m, fakeSource(periodsOf(['2026Q1', '2026Q2'])).source);
    expect(summary.restated).toEqual(['AAA 2026Q1: eps']);
    expect(logs).toContain('restated AAA 2026Q1: eps');
    expect(m.table.get('AAA|2026Q1')).toMatchObject({ eps: 1000, source: 'fake-src' });
  });
  test('failed symbol: no gap planning for it, others continue; circuit breaker skips', async () => {
    const m = memoryStore({ watchlist: ['AAA', 'BBB'], stored: [rec('AAA', '2025Q4')] });
    const { summary } = await run(m, fakeSource((s) => (s === 'AAA' ? new SourceError('HTTP 503', true) : periodsOf(['2026Q2'])(s))).source);
    expect(summary.failedSymbols).toEqual(['AAA']);
    expect(summary.missingPeriods).toEqual({});
    expect(m.table.has('BBB|2026Q2')).toBe(true);
    expect(summary.ok).toBe(false);

    const n = memoryStore({ watchlist: ['AAA', 'BBB', 'CCC', 'DDD'] });
    const { source, asked } = fakeSource(() => new SourceError('HTTP 503', true));
    const out = await run(n, source, { config: { ...FINANCIALS_SYNC_CONFIG, maxConsecutiveFailures: 2 } });
    expect(asked).toEqual(['AAA', 'BBB']);
    expect(out.summary.skippedSymbols).toEqual(['CCC', 'DDD']);
  });
  test('sector: written with source + fetched_at; null not written; fetch error keeps rows, ok false', async () => {
    const m = memoryStore({ watchlist: ['AAA', 'BBB', 'CCC'] });
    const { source } = fakeSource(periodsOf(['2026Q2']), (s) => (s === 'AAA' ? 'Banks' : s === 'BBB' ? null : new SourceError('HTTP 500', true)));
    const { summary } = await run(m, source);
    expect(m.sectors).toEqual({ AAA: { sector: 'Banks', source: 'fake-src', fetchedAt: NOW.toISOString() } });
    expect(summary.sectorsUpdated).toBe(1);
    expect(summary.sectorMissing).toEqual(['BBB']);
    expect(summary.sectorFailedSymbols).toEqual(['CCC']);
    expect(m.table.has('CCC|2026Q2')).toBe(true);
    expect(summary.ok).toBe(false);
  });
  test('dry-run: no writes; summary still lists missingPeriods', async () => {
    const m = memoryStore({ watchlist: ['AAA'] });
    const { summary } = await run(m, fakeSource(periodsOf(['2025Q4', '2026Q2'])).source, { dryRun: true });
    expect(m.calls).toEqual({ upsert: 0, insertGaps: 0, resolve: 0, sector: 0 });
    expect(summary).toMatchObject({ dryRun: true, rowsUpserted: 0, gapsRecorded: 0, sectorsUpdated: 0, missingPeriods: { AAA: ['2026Q1'] } });
  });
  test('symbol union watchlist + held, normalised, sorted; ledger error -> ledgerError, ok false, watchlist still synced', async () => {
    const m = memoryStore({ watchlist: ['vnm', 'FPT', '??'], held: { ok: true, value: ['HPG', 'FPT'] } });
    const a = await run(m, fakeSource(periodsOf([])).source);
    expect(a.summary.symbols).toEqual(['FPT', 'HPG', 'VNM']);
    const n = memoryStore({ watchlist: ['VNM'], held: { ok: false, error: { code: 'DB_ERROR' } } as unknown as Result<string[]> });
    const b = await run(n, fakeSource(periodsOf(['2026Q2'])).source);
    expect(b.summary.symbols).toEqual(['VNM']);
    expect(b.summary.ledgerError).toBe('DB_ERROR');
    expect(b.summary.ok).toBe(false);
  });
  test('works with any FinancialsSource (fake source)', async () => {
    const m = memoryStore({ watchlist: ['AAA'] });
    const { summary } = await run(m, fakeSource(periodsOf(['2026Q2'])).source);
    expect(summary).toMatchObject({ ok: true, source: 'fake-src', rowsUpserted: 1 });
  });
});
