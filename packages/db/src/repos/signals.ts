import type { Db } from '../client';
import { unwrap } from '../errors';
import type { SignalInsert } from '../rows';

/**
 * Idempotent upsert on (symbol, rule_id, horizon, signal_date); a later duplicate in the input wins.
 * Sequential chunks, no `.select()`. Returns the number of rows sent.
 */
export async function upsertSignals(
  db: Db,
  rows: readonly SignalInsert[],
  { chunkSize = 500 }: { chunkSize?: number } = {},
): Promise<number> {
  const ctx = { table: 'signals', op: 'upsert' };
  const byKey = new Map<string, SignalInsert>();
  for (const row of rows) byKey.set(`${row.symbol}|${row.rule_id}|${row.horizon}|${row.signal_date}`, row);
  const unique = [...byKey.values()];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const res = await db.from('signals').upsert(unique.slice(i, i + chunkSize), { onConflict: 'symbol,rule_id,horizon,signal_date' });
    if (res.error) unwrap(res, ctx);
  }
  return unique.length;
}
