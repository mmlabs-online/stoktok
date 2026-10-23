import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import { createTransaction, deleteTransaction, listTransactions, updateTransaction } from './transactions';

const row = (o: Record<string, unknown> = {}) => ({
  id: 'a',
  seq: 1,
  trade_date: '2026-01-05',
  symbol: 'FPT',
  side: 'buy',
  quantity: 100,
  price: 10000,
  fee: null,
  tax: null,
  source: 'manual',
  import_batch_id: null,
  external_ref: null,
  ...o,
});
const input = { tradeDate: '2026-01-05', symbol: 'FPT', side: 'buy', quantity: 100, price: 10000 } as const;

describe('transactions repo', () => {
  test('list selects explicit columns and orders trade_date asc then seq asc', async () => {
    const f = createFake();
    f.respond({ data: [row()] });
    await listTransactions(f.db);
    expect(f.methods('select')[0]?.args[0]).toContain('trade_date');
    expect(f.methods('select')[0]?.args[0]).not.toBe('*');
    expect(f.methods('order').map((c) => c.args)).toEqual([
      ['trade_date', { ascending: true }],
      ['seq', { ascending: true }],
    ]);
  });

  test('list returns same-day rows sorted by seq even if the client returns them out of order', async () => {
    const f = createFake();
    f.respond({ data: [row({ id: 'c', seq: 3 }), row({ id: 'b', seq: 2 })] });
    expect((await listTransactions(f.db)).map((t) => t.id)).toEqual(['b', 'c']);
  });

  test("list maps string bigint seq/fee ('123' → 123)", async () => {
    const f = createFake();
    f.respond({ data: [row({ seq: '123', fee: '456' })] });
    const [tx] = await listTransactions(f.db);
    expect(tx).toMatchObject({ seq: 123, fee: 456, tradeDate: '2026-01-05' });
  });

  test("list throws DataError MAPPING when seq is '9007199254740993'", async () => {
    const f = createFake();
    f.respond({ data: [row({ seq: '9007199254740993' })] });
    await expect(listTransactions(f.db)).rejects.toMatchObject({ name: 'DataError', code: 'MAPPING' });
  });

  test("list with symbol adds eq('symbol', …)", async () => {
    const f = createFake();
    f.respond({ data: [] });
    await listTransactions(f.db, { symbol: 'FPT' });
    expect(f.methods('eq')[0]?.args).toEqual(['symbol', 'FPT']);
  });

  test('list pages with range until a short page', async () => {
    const f = createFake();
    // page size is 1000; multi-page behaviour is covered by fetchAll in errors.test.ts
    f.respond({ data: [row({ id: 'a', seq: 1 }), row({ id: 'b', seq: 2 })] });
    const out = await listTransactions(f.db);
    expect(out).toHaveLength(2);
    expect(f.methods('range').map((c) => c.args)).toEqual([[0, 999]]);
  });

  test('create inserts transactionToInsert payload without id or seq and returns mapped row', async () => {
    const f = createFake();
    f.respond({ data: row({ seq: 7 }) });
    const tx = await createTransaction(f.db, input, { source: 'manual' });
    const payload = f.methods('insert')[0]?.args[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ trade_date: '2026-01-05', symbol: 'FPT', source: 'manual' });
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('seq');
    expect(tx.seq).toBe(7);
  });

  test('update writes only trade fields and returns NOT_FOUND when no row', async () => {
    const f = createFake();
    f.respond({ data: null });
    await expect(updateTransaction(f.db, 'a', input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(Object.keys(f.methods('update')[0]?.args[0] as object).sort()).toEqual(
      ['fee', 'price', 'quantity', 'side', 'symbol', 'tax', 'trade_date'],
    );
  });

  test('delete returns NOT_FOUND when nothing deleted', async () => {
    const f = createFake();
    f.respond({ data: [] });
    await expect(deleteTransaction(f.db, 'a')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
