import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import type { FinancialInsert } from '../rows';
import { listFinancials, upsertFinancials } from './financials';

const row = (symbol: string, period: string, eps = 1000): FinancialInsert => ({
  symbol, period, eps, bvps: 20000, revenue: 1_000_000_000, net_income: 100_000_000, source: 'fake', fetched_at: '2026-10-26T00:00:00.000Z',
});

describe('upsertFinancials', () => {
  test('dedupes (later wins), chunks, onConflict symbol,period, no select, returns count', async () => {
    const f = createFake();
    for (let i = 0; i < 3; i++) f.respond({});
    const rows = [row('A', '2026Q1'), row('A', '2026Q1', 2000), row('A', '2026Q2'), row('B', '2026Q1'), row('B', '2026Q2'), row('C', '2026Q1')];
    expect(await upsertFinancials(f.db, rows, { chunkSize: 2 })).toBe(5);
    const ups = f.methods('upsert');
    expect(ups).toHaveLength(3);
    expect(ups[0]?.args[1]).toEqual({ onConflict: 'symbol,period' });
    expect((ups[0]?.args[0] as FinancialInsert[])[0]?.eps).toBe(2000);
    expect(f.methods('select')).toHaveLength(0);
  });
  test('empty -> no call', async () => {
    const f = createFake();
    expect(await upsertFinancials(f.db, [])).toBe(0);
    expect(f.calls).toHaveLength(0);
  });
  test('23514 -> DataError VALIDATION', async () => {
    const f = createFake();
    f.respond({ error: { code: '23514' } });
    await expect(upsertFinancials(f.db, [row('A', '2026Q1')])).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('listFinancials', () => {
  test('in(symbol), gte(period), maps bigint strings to safe ints', async () => {
    const f = createFake();
    f.respond({ data: [{ ...row('A', '2026Q1'), eps: '1500', revenue: '1000000000000' }] });
    const out = await listFinancials(f.db, ['A', 'B'], '2025Q1');
    expect(f.methods('in')[0]?.args).toEqual(['symbol', ['A', 'B']]);
    expect(f.methods('gte')[0]?.args).toEqual(['period', '2025Q1']);
    expect(out[0]).toMatchObject({ symbol: 'A', period: '2026Q1', eps: 1500, revenue: 1_000_000_000_000, netIncome: 100_000_000 });
  });
  test('empty symbols -> no call', async () => {
    const f = createFake();
    expect(await listFinancials(f.db, [], '2025Q1')).toEqual([]);
    expect(f.calls).toHaveLength(0);
  });
  test('row without source -> MAPPING', async () => {
    const f = createFake();
    f.respond({ data: [{ ...row('A', '2026Q1'), source: '' }] });
    await expect(listFinancials(f.db, ['A'], '2025Q1')).rejects.toMatchObject({ code: 'MAPPING' });
  });
});
