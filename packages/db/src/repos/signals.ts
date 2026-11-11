import type { StoredSignal } from '@stoktok/core';
import { mapRow } from '../errors';
import { signalFromRow } from '../mappers';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';
import { PG_FANOUT_CONCURRENCY } from '../pg/config';
import { mapLimit } from '../pg/fanout';
import { jsonb, pickRows, upsertChunked } from '../pg/upsert';
import type { SignalInsert, SignalRow } from '../rows';

const COLS = ['symbol', 'rule_id', 'signal_date', 'status', 'label', 'value', 'reason_codes', 'inputs_snapshot', 'rule_version', 'computed_at'] as const;
const INSERT_COLS = [
  'symbol',
  'rule_id',
  'horizon',
  'signal_date',
  'status',
  'label',
  'value',
  'data_fresh',
  'reason_codes',
  'inputs_snapshot',
  'rule_version',
  'computed_at',
] as const;

/**
 * The newest stored medium-term signal of each rule for one symbol, in `ruleIds` order; a rule without a
 * row is omitted. One query per rule (like getLatestCloses). Nothing is filtered by date: core decides visibility.
 */
export async function listLatestSignals(db: PgDb, symbol: string, ruleIds: readonly string[]): Promise<StoredSignal[]> {
  const ctx = { table: 'signals', op: 'latest' };
  const rows = await mapLimit(ruleIds, PG_FANOUT_CONCURRENCY, (ruleId) =>
    q(db, ctx, (k) =>
      k
        .selectFrom('signals')
        .select(COLS)
        .where('symbol', '=', symbol)
        .where('horizon', '=', 'medium')
        .where('rule_id', '=', ruleId)
        .orderBy('signal_date', 'desc')
        .limit(1)
        .executeTakeFirst(),
    ),
  );
  return rows.flatMap((row) => (row ? [mapRow(signalFromRow, row as SignalRow, ctx)] : []));
}

/**
 * Idempotent upsert on (symbol, rule_id, horizon, signal_date); a later duplicate in the input wins.
 * Chunks run in one transaction. Returns the number of unique rows written.
 */
export async function upsertSignals(
  db: PgDb,
  rows: readonly SignalInsert[],
  { chunkSize = 500 }: { chunkSize?: number } = {},
): Promise<number> {
  const ctx = { table: 'signals', op: 'upsert' };
  const byKey = new Map<string, SignalInsert>();
  for (const row of rows) byKey.set(`${row.symbol}|${row.rule_id}|${row.horizon}|${row.signal_date}`, row);
  const unique = [...byKey.values()];
  const values = pickRows(unique, INSERT_COLS).map((r) => ({ ...r, inputs_snapshot: jsonb(r.inputs_snapshot) }));
  await upsertChunked(db, ctx, 'signals', values, ['symbol', 'rule_id', 'horizon', 'signal_date'], chunkSize);
  return unique.length;
}
