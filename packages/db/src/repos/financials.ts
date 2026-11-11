import { mapRow } from '../errors';
import { financialFromRow } from '../mappers';
import type { FinancialRecord } from '../mappers';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';
import { pickRows, upsertChunked } from '../pg/upsert';
import type { FinancialInsert, FinancialRow } from '../rows';

const COLS = ['symbol', 'period', 'eps', 'bvps', 'revenue', 'net_income', 'source', 'fetched_at'] as const;

/** Stored quarters for the symbols from `fromPeriod` ('YYYYQn') on, in one query. */
export async function listFinancials(db: PgDb, symbols: readonly string[], fromPeriod: string): Promise<FinancialRecord[]> {
  if (symbols.length === 0) return [];
  const ctx = { table: 'financials', op: 'list' };
  const rows = await q(db, ctx, (k) => k.selectFrom('financials').select(COLS).where('symbol', 'in', [...symbols]).where('period', '>=', fromPeriod).execute());
  return rows.map((r) => mapRow(financialFromRow, r as FinancialRow, ctx));
}

/**
 * Idempotent upsert on (symbol, period); a later duplicate in the input wins. Every column, including
 * fetched_at, is overwritten (restatement policy, docs/adr/0002). Chunks run in one transaction.
 * Returns the number of unique rows written.
 */
export async function upsertFinancials(
  db: PgDb,
  rows: readonly FinancialInsert[],
  { chunkSize = 500 }: { chunkSize?: number } = {},
): Promise<number> {
  const ctx = { table: 'financials', op: 'upsert' };
  const byKey = new Map<string, FinancialInsert>();
  for (const row of rows) byKey.set(`${row.symbol}|${row.period}`, row);
  const unique = [...byKey.values()];
  await upsertChunked(db, ctx, 'financials', pickRows(unique, COLS), ['symbol', 'period'], chunkSize);
  return unique.length;
}
