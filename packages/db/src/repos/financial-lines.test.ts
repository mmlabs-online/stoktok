import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import type { FinancialLineInsert } from '../rows';
import { listFinancialLines, upsertFinancialLines } from './financial-lines';

const row = (symbol: string, period: string, line: string, value = 1000): FinancialLineInsert => ({
  symbol, period_kind: 'quarter', period, statement: 'income', line, value, source: 'fake', fetched_at: '2026-11-08T00:00:00.000Z',
});

describe('upsertFinancialLines', () => {
  test('dedupes by full key (last wins), chunks, onConflict symbol,period_kind,period,line, no select', async () => {
    const f = createFake();
    for (let i = 0; i < 3; i++) f.respond({});
    const rows = [row('A', '2026Q1', 'revenue'), row('A', '2026Q1', 'revenue', 2000), row('A', '2026Q1', 'gross_profit'), row('A', '2026Q2', 'revenue'), row('B', '2026Q1', 'revenue'), { ...row('B', '2026Q1', 'revenue'), period_kind: 'year' as const, period: '2026' }];
    expect(await upsertFinancialLines(f.db, rows, { chunkSize: 2 })).toBe(5);
    const ups = f.methods('upsert');
    expect(ups).toHaveLength(3);
    expect(ups[0]?.args[1]).toEqual({ onConflict: 'symbol,period_kind,period,line' });
    expect((ups[0]?.args[0] as FinancialLineInsert[])[0]?.value).toBe(2000);
    expect(f.methods('select')).toHaveLength(0);
  });
  test('empty -> no call', async () => {
    const f = createFake();
    expect(await upsertFinancialLines(f.db, [])).toBe(0);
    expect(f.calls).toHaveLength(0);
  });
  test('23514 -> DataError VALIDATION', async () => {
    const f = createFake();
    f.respond({ error: { code: '23514' } });
    await expect(upsertFinancialLines(f.db, [row('A', '2026Q1', 'revenue')])).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('listFinancialLines', () => {
  test('filters symbols in, period_kind eq, period gte; maps bigint strings to safe ints', async () => {
    const f = createFake();
    f.respond({ data: [{ ...row('A', '2026Q1', 'revenue'), value: '1000000000000' }] });
    const out = await listFinancialLines(f.db, ['A', 'B'], 'quarter', '2025Q1');
    expect(f.methods('in')[0]?.args).toEqual(['symbol', ['A', 'B']]);
    expect(f.methods('eq')[0]?.args).toEqual(['period_kind', 'quarter']);
    expect(f.methods('gte')[0]?.args).toEqual(['period', '2025Q1']);
    expect(out[0]).toMatchObject({ symbol: 'A', periodKind: 'quarter', period: '2026Q1', line: 'revenue', value: 1_000_000_000_000, source: 'fake' });
  });
  test('empty symbols -> no query', async () => {
    const f = createFake();
    expect(await listFinancialLines(f.db, [], 'year', '2020')).toEqual([]);
    expect(f.calls).toHaveLength(0);
  });
  test('row without source, or a year label on a quarter row -> MAPPING', async () => {
    const f = createFake();
    f.respond({ data: [{ ...row('A', '2026Q1', 'revenue'), source: '' }] });
    await expect(listFinancialLines(f.db, ['A'], 'quarter', '2025Q1')).rejects.toMatchObject({ code: 'MAPPING' });
    f.respond({ data: [{ ...row('A', '2026', 'revenue') }] });
    await expect(listFinancialLines(f.db, ['A'], 'quarter', '2025Q1')).rejects.toMatchObject({ code: 'MAPPING' });
  });
});
