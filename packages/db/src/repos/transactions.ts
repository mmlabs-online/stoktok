import { transactionFromRow, transactionToInsert } from '@stoktok/core';
import type { Transaction, TransactionRow } from '@stoktok/core';
import type { Db } from '../client';
import { DataError, fetchAll, mapRow, unwrap, unwrapFound } from '../errors';

const COLS = 'id,seq,trade_date,symbol,side,quantity,price,fee,tax,source,import_batch_id,external_ref';
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

export async function listTransactions(db: Db, opts: { symbol?: string } = {}): Promise<Transaction[]> {
  const ctx = { table: 'transactions', op: 'list' };
  const rows = await fetchAll<TransactionRow>(
    (from, to) => {
      let q = db.from('transactions').select(COLS);
      if (opts.symbol !== undefined) q = q.eq('symbol', opts.symbol);
      return q.order('trade_date', { ascending: true }).order('seq', { ascending: true }).range(from, to);
    },
    ctx,
  );
  return rows.map((r) => mapRow(transactionFromRow, r, ctx)).sort(compareTransactions);
}

export async function createTransaction(
  db: Db,
  input: TxInput,
  meta: { source: 'manual' | 'import'; importBatchId?: string; externalRef?: string },
): Promise<Transaction> {
  const ctx = { table: 'transactions', op: 'create' };
  const row = unwrap<TransactionRow>(await db.from('transactions').insert(transactionToInsert(input, meta)).select(COLS).single(), ctx);
  return mapRow(transactionFromRow, row, ctx);
}

export async function updateTransaction(db: Db, id: string, input: TxInput): Promise<Transaction> {
  const ctx = { table: 'transactions', op: 'update' };
  const row = unwrapFound<TransactionRow>(
    await db.from('transactions').update(tradeFields(input)).eq('id', id).select(COLS).maybeSingle(),
    ctx,
  );
  return mapRow(transactionFromRow, row, ctx);
}

export async function deleteTransaction(db: Db, id: string): Promise<void> {
  const ctx = { table: 'transactions', op: 'delete' };
  const rows = unwrap<unknown[]>(await db.from('transactions').delete().eq('id', id).select('id'), ctx);
  if (rows.length === 0) throw new DataError('NOT_FOUND', ctx.table, ctx.op, 'not found');
}
