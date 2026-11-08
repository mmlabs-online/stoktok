import type { Db } from '../client';
import { mapRow, unwrap } from '../errors';
import { financialLineFromRow } from '../mappers';
import type { FinancialLineRecord } from '../mappers';
import type { FinancialLineInsert, FinancialLineRow } from '../rows';

const COLS = 'symbol,period_kind,period,statement,line,value,source,fetched_at';

/** Stored lines of one period kind for the symbols from `fromPeriod` on, in one query. */
export async function listFinancialLines(
  db: Db,
  symbols: readonly string[],
  periodKind: 'quarter' | 'year',
  fromPeriod: string,
): Promise<FinancialLineRecord[]> {
  if (symbols.length === 0) return [];
  const ctx = { table: 'financial_lines', op: 'list' };
  const rows = unwrap<FinancialLineRow[]>(
    await db.from('financial_lines').select(COLS).in('symbol', [...symbols]).eq('period_kind', periodKind).gte('period', fromPeriod),
    ctx,
  );
  return rows.map((r) => mapRow(financialLineFromRow, r, ctx));
}

/**
 * Idempotent upsert on (symbol, period_kind, period, line); a later duplicate in the input wins. Every column,
 * including fetched_at, is overwritten (restatement policy, docs/adr/0002). Sequential chunks, no `.select()`.
 * Returns the number of rows sent.
 */
export async function upsertFinancialLines(
  db: Db,
  rows: readonly FinancialLineInsert[],
  { chunkSize = 500 }: { chunkSize?: number } = {},
): Promise<number> {
  const ctx = { table: 'financial_lines', op: 'upsert' };
  const byKey = new Map<string, FinancialLineInsert>();
  for (const row of rows) byKey.set(`${row.symbol}|${row.period_kind}|${row.period}|${row.line}`, row);
  const unique = [...byKey.values()];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const res = await db.from('financial_lines').upsert(unique.slice(i, i + chunkSize), { onConflict: 'symbol,period_kind,period,line' });
    if (res.error) unwrap(res, ctx);
  }
  return unique.length;
}
