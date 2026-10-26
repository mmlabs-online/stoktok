import type { Db } from '../client';
import { mapRow, unwrap } from '../errors';
import { financialFromRow } from '../mappers';
import type { FinancialRecord } from '../mappers';
import type { FinancialInsert, FinancialRow } from '../rows';

const COLS = 'symbol,period,eps,bvps,revenue,net_income,source,fetched_at';

/** Stored quarters for the symbols from `fromPeriod` ('YYYYQn') on, in one query. */
export async function listFinancials(db: Db, symbols: readonly string[], fromPeriod: string): Promise<FinancialRecord[]> {
  if (symbols.length === 0) return [];
  const ctx = { table: 'financials', op: 'list' };
  const rows = unwrap<FinancialRow[]>(
    await db.from('financials').select(COLS).in('symbol', [...symbols]).gte('period', fromPeriod),
    ctx,
  );
  return rows.map((r) => mapRow(financialFromRow, r, ctx));
}

/**
 * Idempotent upsert on (symbol, period); a later duplicate in the input wins. Every column, including
 * fetched_at, is overwritten (restatement policy, docs/adr/0002). Sequential chunks, no `.select()`.
 * Returns the number of rows sent.
 */
export async function upsertFinancials(
  db: Db,
  rows: readonly FinancialInsert[],
  { chunkSize = 500 }: { chunkSize?: number } = {},
): Promise<number> {
  const ctx = { table: 'financials', op: 'upsert' };
  const byKey = new Map<string, FinancialInsert>();
  for (const row of rows) byKey.set(`${row.symbol}|${row.period}`, row);
  const unique = [...byKey.values()];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const res = await db.from('financials').upsert(unique.slice(i, i + chunkSize), { onConflict: 'symbol,period' });
    if (res.error) unwrap(res, ctx);
  }
  return unique.length;
}
