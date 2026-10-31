import type { StoredSignal } from '@stoktok/core';
import type { Db } from '../client';
import { DataError, mapRow, unwrap, unwrapFound } from '../errors';
import { signalFromRow } from '../mappers';
import type { SignalInsert, SignalRow } from '../rows';

const COLS = 'symbol,rule_id,signal_date,status,label,value,reason_codes,inputs_snapshot,rule_version,computed_at';

/**
 * The newest stored medium-term signal of each rule for one symbol, in `ruleIds` order; a rule without a
 * row is omitted. One query per rule (like getLatestCloses). Nothing is filtered by date: core decides visibility.
 */
export async function listLatestSignals(db: Db, symbol: string, ruleIds: readonly string[]): Promise<StoredSignal[]> {
  const ctx = { table: 'signals', op: 'latest' };
  const rows = await Promise.all(
    ruleIds.map(async (ruleId) => {
      try {
        return unwrapFound<SignalRow>(
          await db
            .from('signals')
            .select(COLS)
            .eq('symbol', symbol)
            .eq('horizon', 'medium')
            .eq('rule_id', ruleId)
            .order('signal_date', { ascending: false })
            .limit(1)
            .maybeSingle(),
          ctx,
        );
      } catch (e) {
        if (e instanceof DataError && e.code === 'NOT_FOUND') return null;
        throw e;
      }
    }),
  );
  return rows.flatMap((row) => (row ? [mapRow(signalFromRow, row, ctx)] : []));
}

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
