import { mapRow } from '../errors';
import { financialLineFromRow } from '../mappers';
import type { FinancialLineRecord } from '../mappers';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';
import { pickRows, upsertChunked } from '../pg/upsert';
import type { FinancialLineInsert, FinancialLineRow } from '../rows';

const COLS = ['symbol', 'period_kind', 'period', 'statement', 'line', 'value', 'source', 'fetched_at'] as const;

/** Stored lines of one period kind for the symbols from `fromPeriod` on, in one query. */
export async function listFinancialLines(
  db: PgDb,
  symbols: readonly string[],
  periodKind: 'quarter' | 'year',
  fromPeriod: string,
): Promise<FinancialLineRecord[]> {
  if (symbols.length === 0) return [];
  const ctx = { table: 'financial_lines', op: 'list' };
  const rows = await q(db, ctx, (k) =>
    k.selectFrom('financial_lines').select(COLS).where('symbol', 'in', [...symbols]).where('period_kind', '=', periodKind).where('period', '>=', fromPeriod).execute(),
  );
  return rows.map((r) => mapRow(financialLineFromRow, r as FinancialLineRow, ctx));
}

/**
 * Idempotent upsert on (symbol, period_kind, period, line); a later duplicate in the input wins. Every
 * column, including fetched_at, is overwritten (restatement policy, docs/adr/0002). Chunks run in one transaction.
 * Returns the number of unique rows written.
 */
export async function upsertFinancialLines(
  db: PgDb,
  rows: readonly FinancialLineInsert[],
  { chunkSize = 500 }: { chunkSize?: number } = {},
): Promise<number> {
  const ctx = { table: 'financial_lines', op: 'upsert' };
  const byKey = new Map<string, FinancialLineInsert>();
  for (const row of rows) byKey.set(`${row.symbol}|${row.period_kind}|${row.period}|${row.line}`, row);
  const unique = [...byKey.values()];
  await upsertChunked(db, ctx, 'financial_lines', pickRows(unique, COLS), ['symbol', 'period_kind', 'period', 'line'], chunkSize);
  return unique.length;
}
