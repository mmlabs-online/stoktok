import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { listFinancialLines, upsertFinancialLines } from '../src/repos/financial-lines';
import { listFinancials, upsertFinancials } from '../src/repos/financials';
import type { FinancialInsert, FinancialLineInsert } from '../src/rows';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

const fin = (symbol: string, period: string, o: Partial<FinancialInsert> = {}): FinancialInsert => ({
  symbol,
  period,
  eps: 1000,
  bvps: 20000,
  revenue: 5_000_000_000,
  net_income: 400_000_000,
  source: 's1',
  fetched_at: '2026-10-26T00:00:00+00:00',
  ...o,
});
const line = (symbol: string, period: string, l: string, o: Partial<FinancialLineInsert> = {}): FinancialLineInsert => ({
  symbol,
  period_kind: 'quarter',
  period,
  statement: 'income',
  line: l,
  value: 123,
  source: 's1',
  fetched_at: '2026-11-08T00:00:00+00:00',
  ...o,
});

describe('financials', () => {
  test('restatement overwrites values and fetched_at (key symbol, period); fromPeriod filter; empty symbols → []', async () => {
    await upsertFinancials(t.pgDb, [fin('FA', '2025Q4'), fin('FA', '2026Q1')]);
    await upsertFinancials(t.pgDb, [fin('FA', '2026Q1', { eps: 1111, revenue: 6_000_000_000, source: 's2', fetched_at: '2026-11-01T00:00:00+00:00' })]);
    const all = await listFinancials(t.pgDb, ['FA'], '2025Q1');
    expect(all).toHaveLength(2);
    const restated = all.find((r) => r.period === '2026Q1')!;
    expect(restated).toMatchObject({ eps: 1111, revenue: 6_000_000_000, source: 's2', fetchedAt: '2026-11-01T00:00:00+00:00' });
    expect(await listFinancials(t.pgDb, ['FA'], '2026Q1')).toHaveLength(1);
    expect(await listFinancials(t.pgDb, [], '2025Q1')).toEqual([]);
    expect(await upsertFinancials(t.pgDb, [fin('FA', '2026Q1'), fin('FA', '2026Q1', { eps: 5 })])).toBe(1);
  });
});

describe('financial_lines', () => {
  test('same line with a different statement replaces it (4-column key); period_kind filter; empty symbols → []', async () => {
    await upsertFinancialLines(t.pgDb, [line('FL', '2026Q1', 'revenue'), line('FL', '2026', 'revenue', { period_kind: 'year' })]);
    await upsertFinancialLines(t.pgDb, [line('FL', '2026Q1', 'revenue', { statement: 'balance', value: 999, source: 's2' })]);
    const q = await listFinancialLines(t.pgDb, ['FL'], 'quarter', '2025Q1');
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ statement: 'balance', value: 999, source: 's2' });
    expect(await listFinancialLines(t.pgDb, ['FL'], 'year', '2020')).toHaveLength(1);
    expect(await listFinancialLines(t.pgDb, [], 'quarter', '2025Q1')).toEqual([]);
  });
});
