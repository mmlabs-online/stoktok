import { toSafeInt } from '@stoktok/core';
import { DataError, mapRow } from '../errors';
import { aiSummaryFromRow } from '../mappers';
import type { AiSummaryRecord } from '../mappers';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';
import { jsonb, upsertInto } from '../pg/upsert';
import type { AiSummaryInsert, AiSummaryRow } from '../rows';

const COLS = ['id', 'scope', 'symbol', 'summary_date', 'generator', 'provider', 'model', 'usage_id', 'body_version', 'body', 'input_ids', 'created_at'] as const;

/**
 * Replaces the summary of (scope, symbol, summary_date) or inserts it; every column is sent, so no stale value survives.
 * Writes no validation: core validates the body before the call. Returns the row id.
 */
export async function upsertAiSummary(db: PgDb, row: AiSummaryInsert): Promise<number> {
  const ctx = { table: 'ai_summaries', op: 'upsert' };
  const values = { ...row, body: jsonb(row.body) };
  const ids = await q(db, ctx, (k) => upsertInto(k, 'ai_summaries', [values], ['scope', 'symbol', 'summary_date']).returning('id').execute());
  const first = ids[0];
  if (!first) throw new DataError('DB_ERROR', ctx.table, ctx.op, 'no data returned');
  return mapRow((r: { id: unknown }) => toSafeInt(r.id, 'id', ctx.table), first, ctx);
}

/** All summaries (symbols and the portfolio) of one session date. A body that fails core validation maps to `body: null`. */
export async function listAiSummariesForDate(db: PgDb, date: string): Promise<AiSummaryRecord[]> {
  const ctx = { table: 'ai_summaries', op: 'list_for_date' };
  const rows = await q(db, ctx, (k) => k.selectFrom('ai_summaries').select(COLS).where('summary_date', '=', date).orderBy('symbol', 'asc').execute());
  return rows.map((r) => mapRow(aiSummaryFromRow, r as AiSummaryRow, ctx));
}
