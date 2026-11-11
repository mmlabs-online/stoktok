import { toSafeInt, transactionFromRow, transactionToInsert } from '@stoktok/core';
import type { Transaction, TransactionRow } from '@stoktok/core';
import { sql } from 'kysely';
import type { SelectQueryBuilder } from 'kysely';
import { DataError, found, mapRow } from '../errors';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';
import type { Database } from '../pg/schema';

const COLS = ['id', 'seq', 'trade_date', 'symbol', 'side', 'quantity', 'price', 'fee', 'tax', 'source', 'import_batch_id', 'external_ref'] as const;
type TxInput = Omit<Transaction, 'id' | 'seq'>;

function compareTransactions(a: Transaction, b: Transaction): number {
  if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1;
  return a.seq - b.seq;
}

/** Fields an update may change (never source, import ids or seq). */
function tradeFields(input: TxInput) {
  const { trade_date, symbol, side, quantity, price, fee, tax } = transactionToInsert(input, { source: 'manual' });
  return { trade_date, symbol, side, quantity, price, fee, tax };
}

export async function listTransactions(db: PgDb, opts: { symbol?: string } = {}): Promise<Transaction[]> {
  const ctx = { table: 'transactions', op: 'list' };
  const rows = await q(db, ctx, (k) => {
    let b = k.selectFrom('transactions').select(COLS);
    if (opts.symbol !== undefined) b = b.where('symbol', '=', opts.symbol);
    return b.orderBy('trade_date', 'asc').orderBy('seq', 'asc').execute();
  });
  return rows.map((r) => mapRow(transactionFromRow, r as TransactionRow, ctx)).sort(compareTransactions);
}

export interface TransactionPageQuery {
  symbol?: string;
  side?: 'buy' | 'sell';
  /** Inclusive 'YYYY-MM-DD' bounds. */
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

function withFilters<O>(
  b: SelectQueryBuilder<Database, 'transactions', O>,
  opts: TransactionPageQuery,
): SelectQueryBuilder<Database, 'transactions', O> {
  let out = b;
  if (opts.symbol !== undefined) out = out.where('symbol', '=', opts.symbol);
  if (opts.side !== undefined) out = out.where('side', '=', opts.side);
  if (opts.from !== undefined) out = out.where('trade_date', '>=', opts.from);
  if (opts.to !== undefined) out = out.where('trade_date', '<=', opts.to);
  return out;
}

/** One page of transactions, newest first, with the total count for the same filters. */
export async function listTransactionsPage(
  db: PgDb,
  opts: TransactionPageQuery,
): Promise<{ rows: Transaction[]; total: number }> {
  const ctx = { table: 'transactions', op: 'list-page' };
  const page = await q(db, ctx, (k) =>
    withFilters(k.selectFrom('transactions').select([...COLS, sql<string>`count(*) over()`.as('total')]), opts)
      .orderBy('trade_date', 'desc')
      .orderBy('seq', 'desc')
      .limit(opts.limit)
      .offset(opts.offset)
      .execute(),
  );
  let total: number;
  if (page.length > 0) {
    total = toSafeInt(page[0]!.total, 'total', ctx.table);
  } else if (opts.offset > 0) {
    // An out-of-range page has no row to carry the window count: count separately.
    const counted = await q(db, ctx, (k) =>
      withFilters(k.selectFrom('transactions').select(sql<string>`count(*)`.as('n')), opts).executeTakeFirstOrThrow(),
    );
    total = toSafeInt(counted.n, 'total', ctx.table);
  } else {
    total = 0;
  }
  return {
    rows: page.map((row) => {
      const { total: windowCount, ...r } = row;
      void windowCount;
      return mapRow(transactionFromRow, r as TransactionRow, ctx);
    }),
    total,
  };
}

export async function getTransaction(db: PgDb, id: string): Promise<Transaction> {
  const ctx = { table: 'transactions', op: 'get' };
  const row = await q(db, ctx, (k) => k.selectFrom('transactions').select(COLS).where('id', '=', id).executeTakeFirst());
  return mapRow(transactionFromRow, found(row, ctx) as TransactionRow, ctx);
}

export async function createTransaction(
  db: PgDb,
  input: TxInput,
  meta: { source: 'manual' | 'import'; importBatchId?: string; externalRef?: string },
): Promise<Transaction> {
  const ctx = { table: 'transactions', op: 'create' };
  const values = transactionToInsert(input, meta);
  const row = await q(db, ctx, (k) => k.insertInto('transactions').values(values).returning(COLS).executeTakeFirstOrThrow());
  return mapRow(transactionFromRow, row as TransactionRow, ctx);
}

export async function updateTransaction(db: PgDb, id: string, input: TxInput): Promise<Transaction> {
  const ctx = { table: 'transactions', op: 'update' };
  const fields = tradeFields(input);
  const row = await q(db, ctx, (k) => k.updateTable('transactions').set(fields).where('id', '=', id).returning(COLS).executeTakeFirst());
  return mapRow(transactionFromRow, found(row, ctx) as TransactionRow, ctx);
}

export async function deleteTransaction(db: PgDb, id: string): Promise<void> {
  const ctx = { table: 'transactions', op: 'delete' };
  const rows = await q(db, ctx, (k) => k.deleteFrom('transactions').where('id', '=', id).returning('id').execute());
  if (rows.length === 0) throw new DataError('NOT_FOUND', ctx.table, ctx.op, 'not found');
}
