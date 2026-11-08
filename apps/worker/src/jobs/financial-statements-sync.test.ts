import { addQuarters, latestExpectedPeriod, quarterBounds, yearBounds } from '@stoktok/core';
import type { Result, StatementLine } from '@stoktok/core';
import type { FinancialLineInsert, FinancialLineRecord, OpenGapRecord } from '@stoktok/db';
import { describe, expect, test } from 'vitest';
import { FINANCIAL_STATEMENTS_SYNC_CONFIG } from '../config';
import type { FinancialStatementsSource, StatementPeriod, StatementsResult } from '../sources/financials-source';
import { SourceError } from '../sources/price-source';
import { runFinancialStatementsSync } from './financial-statements-sync';
import type { FinancialStatementsStore } from './financial-statements-sync';

const NOW = new Date('2026-10-26T05:00:00Z'); // windowEnd 2026Q2; year window 2021..2025 (2025-12-31 + 120 d = 2026-04-30)
const CFG = FINANCIAL_STATEMENTS_SYNC_CONFIG;
const END = latestExpectedPeriod('2026-10-26', CFG.publishLagDays);
const START = addQuarters(END, -(CFG.lookbackQuarters - 1));
const LINES: StatementLine[] = ['revenue', 'net_income_parent', 'total_assets'];
const STATEMENT = { revenue: 'income', net_income_parent: 'income', total_assets: 'balance' } as const;

const omitFetchedAt = (r: FinancialLineInsert) => ({ ...r, fetched_at: undefined });
const key = (r: { symbol: string; period_kind: string; period: string; line: string }) => `${r.symbol}|${r.period_kind}|${r.period}|${r.line}`;

function memoryStore(opts: { watchlist?: string[]; held?: Result<string[]>; stored?: FinancialLineInsert[]; gaps?: OpenGapRecord[] } = {}) {
  const table = new Map<string, FinancialLineInsert>();
  for (const r of opts.stored ?? []) table.set(key(r), r);
  const gaps: (OpenGapRecord & { dataType: string; resolvedAt?: string })[] = (opts.gaps ?? []).map((g) => ({ ...g, dataType: 'financial_lines' }));
  const order: string[] = [];
  let nextId = 100;
  const store: FinancialStatementsStore = {
    listWatchlistSymbols: async () => [...(opts.watchlist ?? [])],
    listHeldSymbols: async () => opts.held ?? { ok: true, value: [] },
    listFinancialLines: async (symbols, kind, from) =>
      [...table.values()]
        .filter((r) => symbols.includes(r.symbol) && r.period_kind === kind && r.period >= from)
        .map((r): FinancialLineRecord => ({ symbol: r.symbol, periodKind: r.period_kind, period: r.period, statement: r.statement, line: r.line, value: r.value, source: r.source, fetchedAt: r.fetched_at })),
    upsertFinancialLines: async (rows) => {
      order.push('upsert');
      for (const r of rows) table.set(key(r), r);
      return rows.length;
    },
    listOpenGaps: async (dataType, symbols) => gaps.filter((g) => g.dataType === dataType && g.resolvedAt === undefined && g.symbol !== null && symbols.includes(g.symbol)),
    insertGaps: async (rows) => {
      order.push('insertGaps');
      for (const row of rows) gaps.push({ id: nextId++, symbol: row.symbol, fromTs: row.from_ts, toTs: row.to_ts, dataType: row.data_type });
    },
    resolveGaps: async (ids, at) => {
      order.push('resolveGaps');
      for (const g of gaps) if (ids.includes(g.id)) g.resolvedAt = at;
    },
  };
  return { store, table, gaps, order };
}

const stored = (symbol: string, kind: 'quarter' | 'year', period: string, line: StatementLine, value = 1000): FinancialLineInsert => ({
  symbol, period_kind: kind, period, statement: STATEMENT[line as keyof typeof STATEMENT], line, value, source: 'old', fetched_at: '2026-01-01T00:00:00.000Z',
});
const per = (kind: 'quarter' | 'year', period: string, lines: StatementLine[] = LINES, missing: StatementLine[] = [], value = 1000): StatementPeriod => ({
  periodKind: kind,
  period,
  values: lines.map((line) => ({ line, statement: STATEMENT[line as keyof typeof STATEMENT], value })),
  missing,
});
const range = (from: string, to: string) => {
  const out: string[] = [];
  for (let p = from; p <= to; p = addQuarters(p, 1)) out.push(p);
  return out;
};
const YEARS = ['2021', '2022', '2023', '2024', '2025'];
const full = (): StatementPeriod[] => [...range(START, END).map((p) => per('quarter', p)), ...YEARS.map((y) => per('year', y))];
const result = (periods: StatementPeriod[], rejected: StatementsResult['rejected'] = [], expectedLines: StatementLine[] = LINES): StatementsResult => ({
  companyType: 'CT', expectedLines, periods, rejected,
});

function fakeSource(impl: (symbol: string) => StatementsResult | Error) {
  const asked: string[] = [];
  const source: FinancialStatementsSource = {
    name: 'fake-src',
    fetchStatements: async (symbol) => {
      asked.push(symbol);
      const r = impl(symbol);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { source, asked };
}

const run = (m: ReturnType<typeof memoryStore>, source: FinancialStatementsSource, o: { dryRun?: boolean; now?: Date } = {}) => {
  const logs: string[] = [];
  const sleeps: number[] = [];
  return runFinancialStatementsSync({
    store: m.store, source, now: o.now ?? NOW, config: CFG, sleep: async (ms) => void sleeps.push(ms), log: (x) => void logs.push(x), dryRun: o.dryRun ?? false,
  });
};

describe('runFinancialStatementsSync', () => {
  test('writes quarter and year lines for watchlist + held symbols with source and fetched_at', async () => {
    const m = memoryStore({ watchlist: ['fpt'], held: { ok: true, value: ['HPG'] } });
    const { source, asked } = fakeSource(() => result(full()));
    const s = await run(m, source);
    expect(asked).toEqual(['FPT', 'HPG']);
    expect(s).toMatchObject({ ok: true, windowStart: START, windowEnd: END, yearWindowStart: '2021', yearWindowEnd: '2025', source: 'fake-src' });
    expect(s.linesUpserted).toBe((12 + 5) * 3 * 2);
    expect(s.gapsRecorded).toBe(0);
    for (const r of m.table.values()) {
      expect(r.source).toBe('fake-src');
      expect(r.fetched_at).toBe(NOW.toISOString());
      expect(Number.isInteger(r.value)).toBe(true);
    }
    expect(m.table.get('FPT|year|2025|total_assets')).toMatchObject({ statement: 'balance', value: 1000 });
    expect(m.table.get('HPG|quarter|2026Q2|revenue')).toMatchObject({ statement: 'income' });
  });

  test('second run writes the same rows except fetched_at and records no new gaps', async () => {
    const m = memoryStore({ watchlist: ['FPT'] });
    const periods = full().map((p) => (p.period === '2025Q4' ? per('quarter', '2025Q4', ['revenue', 'net_income_parent'], ['total_assets']) : p));
    const { source } = fakeSource(() => result(periods));
    const first = await run(m, source);
    const snapshot = [...m.table.values()].map((r) => omitFetchedAt(r));
    const second = await run(m, source, { now: new Date('2026-10-27T05:00:00Z') });
    expect(first.gapsRecorded).toBe(1);
    expect(second.gapsRecorded).toBe(0);
    expect(m.gaps).toHaveLength(1);
    expect([...m.table.values()].map((r) => omitFetchedAt(r))).toEqual(snapshot);
    expect(second.restated).toEqual([]);
  });

  test('a mapped line missing in a period writes no row for it and records a period gap (data_type financial_lines)', async () => {
    const m = memoryStore({ watchlist: ['FPT'] });
    const periods = full().map((p) => (p.period === '2025Q4' ? per('quarter', '2025Q4', ['revenue', 'net_income_parent'], ['total_assets']) : p));
    const s = await run(m, fakeSource(() => result(periods)).source);
    expect(m.table.has('FPT|quarter|2025Q4|total_assets')).toBe(false);
    expect(m.table.has('FPT|quarter|2025Q4|revenue')).toBe(true);
    expect(s.missingPeriods).toEqual({ FPT: ['2025Q4'] });
    expect(s.missingLines).toEqual({ FPT: ['2025Q4:total_assets'] });
    const b = quarterBounds('2025Q4');
    expect(m.gaps).toEqual([expect.objectContaining({ symbol: 'FPT', dataType: 'financial_lines', fromTs: b.fromTs, toTs: b.toTs })]);
    expect([...m.table.values()].some((r) => r.value === 0)).toBe(false);
  });

  test('a missing year records a gap with data_type financial_lines_annual and year bounds', async () => {
    const m = memoryStore({ watchlist: ['FPT'] });
    const periods = full().filter((p) => p.period !== '2023');
    const s = await run(m, fakeSource(() => result(periods)).source);
    expect(s.missingYears).toEqual({ FPT: ['2023'] });
    expect(s.missingPeriods).toEqual({});
    const b = yearBounds('2023');
    expect(m.gaps).toEqual([expect.objectContaining({ dataType: 'financial_lines_annual', fromTs: b.fromTs, toTs: b.toTs })]);
  });

  test('a not-applicable line writes no row and no gap', async () => {
    const m = memoryStore({ watchlist: ['VCB'] });
    const lines: StatementLine[] = ['revenue', 'net_income_parent'];
    const periods = full().map((p) => per(p.periodKind, p.period, lines));
    const s = await run(m, fakeSource(() => result(periods, [], lines)).source);
    expect([...m.table.values()].some((r) => r.line === 'total_assets')).toBe(false);
    expect(s.gapsRecorded).toBe(0);
    expect(s.missingLines).toEqual({});
  });

  test('a gap resolves when all mapped lines of the period are present (stored or fetched)', async () => {
    const b = quarterBounds('2025Q4');
    const m = memoryStore({
      watchlist: ['FPT'],
      stored: [stored('FPT', 'quarter', '2025Q4', 'revenue'), stored('FPT', 'quarter', '2025Q4', 'net_income_parent')],
      gaps: [{ id: 7, symbol: 'FPT', fromTs: b.fromTs, toTs: b.toTs }],
    });
    const periods = full().map((p) => (p.period === '2025Q4' ? per('quarter', '2025Q4', ['total_assets']) : p));
    const s = await run(m, fakeSource(() => result(periods)).source);
    expect(s.gapsResolved).toBe(1);
    expect(m.gaps.find((g) => g.id === 7)?.resolvedAt).toBe(NOW.toISOString());
    expect(s.missingLines).toEqual({});
  });

  test('changed stored value is reported in restated as SYM 2026Q2: gross_profit', async () => {
    const m = memoryStore({ watchlist: ['FPT'], stored: [stored('FPT', 'quarter', '2026Q2', 'revenue', 5)] });
    const s = await run(m, fakeSource(() => result(full())).source);
    expect(s.restated).toEqual(['FPT 2026Q2: revenue']);
    expect(m.table.get('FPT|quarter|2026Q2|revenue')?.value).toBe(1000);
    expect(m.table.get('FPT|quarter|2026Q2|revenue')?.source).toBe('fake-src');
  });

  test('dry run writes nothing and still reports missing periods', async () => {
    const m = memoryStore({ watchlist: ['FPT'] });
    const periods = full().filter((p) => p.period !== '2024Q4' && p.period !== '2023');
    const s = await run(m, fakeSource(() => result(periods)).source, { dryRun: true });
    expect(m.order).toEqual([]);
    expect(s).toMatchObject({ dryRun: true, linesUpserted: 0, gapsRecorded: 0, gapsResolved: 0, missingPeriods: { FPT: ['2024Q4'] }, missingYears: { FPT: ['2023'] } });
  });

  test('unsupported company type is reported, not failing; its periods become gaps only if known', async () => {
    const m = memoryStore({ watchlist: ['XYZ'] });
    const rejected = [{ period: '2026Q1', reason: 'unsupported_company_type' }, { period: '2025', reason: 'unsupported_company_type' }];
    const s = await run(m, fakeSource(() => result([], rejected, [])).source);
    expect(s).toMatchObject({ ok: true, unsupportedSymbols: ['XYZ'], rejectedNonFailing: 2, rejected: 0, linesUpserted: 0 });
  });

  test('a failing in-window reject fails the run; an out-of-window reject does not', async () => {
    const m = memoryStore({ watchlist: ['FPT'] });
    const rejected = [{ period: '2025Q4', reason: 'total_assets_out_of_band' }, { period: '2010Q1', reason: 'x' }, { period: '2010', reason: 'x' }];
    const s = await run(m, fakeSource(() => result(full(), rejected)).source);
    expect(s).toMatchObject({ ok: false, rejected: 1, rejectedOutOfWindow: 2 });
    expect(s.rejectedBySymbol).toEqual({ FPT: [{ period: '2025Q4', reason: 'total_assets_out_of_band' }] });
  });

  test('fetch error fails the run; circuit breaker skips after maxConsecutiveFailures', async () => {
    const symbols = Array.from({ length: 8 }, (_, i) => `SYM${i}`);
    const m = memoryStore({ watchlist: symbols });
    const { source, asked } = fakeSource(() => new SourceError('down', true));
    const s = await run(m, source);
    expect(s.ok).toBe(false);
    expect(asked).toHaveLength(CFG.maxConsecutiveFailures);
    expect(s.failedSymbols).toHaveLength(CFG.maxConsecutiveFailures);
    expect(s.skippedSymbols).toEqual(symbols.slice(CFG.maxConsecutiveFailures));
    const m2 = memoryStore({ watchlist: ['AAA', 'BBB'] });
    const s2 = await run(m2, fakeSource((sym) => (sym === 'AAA' ? new Error('boom') : result(full()))).source);
    expect(s2).toMatchObject({ ok: false, failedSymbols: ['AAA'] });
    expect(m2.table.has('BBB|year|2025|revenue')).toBe(true);
  });

  test('symbol with no data -> symbolsWithoutData, no gaps, ok stays true', async () => {
    const m = memoryStore({ watchlist: ['ETF'] });
    const s = await run(m, fakeSource(() => ({ companyType: null, expectedLines: [], periods: [], rejected: [] })).source);
    expect(s).toMatchObject({ ok: true, symbolsWithoutData: ['ETF'], gapsRecorded: 0 });
  });

  test('upsert happens before gap insert and resolve', async () => {
    const m = memoryStore({ watchlist: ['FPT'] });
    await run(m, fakeSource(() => result(full().filter((p) => p.period !== '2023'))).source);
    expect(m.order).toEqual(['upsert', 'insertGaps', 'resolveGaps']);
  });

  test('ledger error on listHeldSymbols is reported and fails the run; watchlist still synced', async () => {
    const m = memoryStore({ watchlist: ['FPT'], held: { ok: false, error: { code: 'DB_ERROR' } } as unknown as Result<string[]> });
    const s = await run(m, fakeSource(() => result(full())).source);
    expect(s.ok).toBe(false);
    expect(s.ledgerError).toBe('DB_ERROR');
    expect(s.symbols).toEqual(['FPT']);
    expect(s.linesUpserted).toBeGreaterThan(0);
  });
});
