import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DataError } from '../src/errors';
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  listTransactionsPage,
  updateTransaction,
} from '../src/repos/transactions';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

const manual = { source: 'manual' as const };
const tx = (o: Partial<{ tradeDate: string; symbol: string; side: 'buy' | 'sell'; quantity: number; price: number; fee: number; tax: number }> = {}) => ({
  tradeDate: '2026-01-05',
  symbol: 'FPT',
  side: 'buy' as const,
  quantity: 100,
  price: 10000,
  ...o,
});
const code = async (p: Promise<unknown>) => {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(DataError);
  return e as DataError;
};

describe('transactions repo', () => {
  test('listTransactions orders by trade_date, seq and filters by symbol', async () => {
    await createTransaction(t.pgDb, tx({ symbol: 'LA', tradeDate: '2026-02-02' }), manual);
    await createTransaction(t.pgDb, tx({ symbol: 'LB', tradeDate: '2026-02-01' }), manual);
    await createTransaction(t.pgDb, tx({ symbol: 'LA', tradeDate: '2026-02-01', side: 'sell' }), manual);
    const all = (await listTransactions(t.pgDb)).filter((r) => r.symbol.startsWith('L'));
    expect(all.map((r) => [r.tradeDate, r.symbol])).toEqual([
      ['2026-02-01', 'LB'],
      ['2026-02-01', 'LA'],
      ['2026-02-02', 'LA'],
    ]);
    expect((await listTransactions(t.pgDb, { symbol: 'LA' })).map((r) => r.tradeDate)).toEqual(['2026-02-01', '2026-02-02']);
  });

  test('listTransactionsPage: total = filtered count, offset window correct, newest first', async () => {
    for (let i = 1; i <= 5; i++) await createTransaction(t.pgDb, tx({ symbol: 'PG', tradeDate: `2026-03-0${i}`, side: i === 5 ? 'sell' : 'buy' }), manual);
    const p1 = await listTransactionsPage(t.pgDb, { symbol: 'PG', limit: 2, offset: 0 });
    expect(p1.total).toBe(5);
    expect(p1.rows.map((r) => r.tradeDate)).toEqual(['2026-03-05', '2026-03-04']);
    const p2 = await listTransactionsPage(t.pgDb, { symbol: 'PG', limit: 2, offset: 2 });
    expect(p2.rows.map((r) => r.tradeDate)).toEqual(['2026-03-03', '2026-03-02']);
    const filtered = await listTransactionsPage(t.pgDb, { symbol: 'PG', side: 'buy', from: '2026-03-02', to: '2026-03-04', limit: 10, offset: 0 });
    expect(filtered.total).toBe(3);
    expect(filtered.rows).toHaveLength(3);
    expect(await listTransactionsPage(t.pgDb, { symbol: 'NONE', limit: 10, offset: 0 })).toEqual({ rows: [], total: 0 });
  });

  test('listTransactionsPage: total stays correct when offset is past the end', async () => {
    const out = await listTransactionsPage(t.pgDb, { symbol: 'PG', limit: 2, offset: 50 });
    expect(out).toEqual({ rows: [], total: 5 });
    const f = await listTransactionsPage(t.pgDb, { symbol: 'PG', side: 'sell', limit: 2, offset: 4 });
    expect(f).toEqual({ rows: [], total: 1 });
  });

  test('duplicate (source, import_batch_id, external_ref) → CONFLICT; two NULL refs do not conflict', async () => {
    const meta = { source: 'import' as const, importBatchId: 'b1', externalRef: 'r1' };
    await createTransaction(t.pgDb, tx({ symbol: 'DUP' }), meta);
    const e = await code(createTransaction(t.pgDb, tx({ symbol: 'DUP' }), meta));
    expect(e).toMatchObject({ code: 'CONFLICT', pgCode: '23505' });
    expect(e.message).not.toContain('r1');
    await createTransaction(t.pgDb, tx({ symbol: 'DUP' }), manual);
    await createTransaction(t.pgDb, tx({ symbol: 'DUP' }), manual);
  });

  test('update keeps seq, source, import_batch_id; changes fee and tax, including to null', async () => {
    const made = await createTransaction(t.pgDb, tx({ symbol: 'UPD', fee: 5, tax: 7 }), { source: 'import', importBatchId: 'bx', externalRef: 'ex' });
    const upd = await updateTransaction(t.pgDb, made.id, tx({ symbol: 'UPD', quantity: 200, fee: 9 }));
    expect(upd).toMatchObject({ id: made.id, seq: made.seq, quantity: 200, fee: 9 });
    expect(upd.tax).toBeUndefined();
    const again = await getTransaction(t.pgDb, made.id);
    expect(again).toMatchObject({ seq: made.seq, fee: 9 });
    expect(again.tax).toBeUndefined();
    // source and import ids are not editable: a re-import of the same key still conflicts
    const e = await code(createTransaction(t.pgDb, tx({ symbol: 'UPD' }), { source: 'import', importBatchId: 'bx', externalRef: 'ex' }));
    expect(e.code).toBe('CONFLICT');
  });

  test('get/update/delete of an unknown id → NOT_FOUND', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await code(getTransaction(t.pgDb, id))).code).toBe('NOT_FOUND');
    expect((await code(updateTransaction(t.pgDb, id, tx()))).code).toBe('NOT_FOUND');
    expect((await code(deleteTransaction(t.pgDb, id))).code).toBe('NOT_FOUND');
  });

  test('delete removes the row', async () => {
    const made = await createTransaction(t.pgDb, tx({ symbol: 'DEL' }), manual);
    await deleteTransaction(t.pgDb, made.id);
    expect((await code(getTransaction(t.pgDb, made.id))).code).toBe('NOT_FOUND');
  });

  test('seq arrives as a digit string and maps to a number', async () => {
    const made = await createTransaction(t.pgDb, tx({ symbol: 'SEQ' }), manual);
    expect(typeof made.seq).toBe('number');
    expect(Number.isSafeInteger(made.seq)).toBe(true);
  });

  test('a check violation → VALIDATION', async () => {
    const e = await code(createTransaction(t.pgDb, tx({ symbol: 'lower' }), manual));
    expect(e).toMatchObject({ code: 'VALIDATION', pgCode: '23514' });
  });
});
