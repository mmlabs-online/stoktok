import { toSafeInt } from '@stoktok/core';
import type { Db } from '../client';
import { DataError, mapRow, unwrap } from '../errors';
import { aiSummaryFromRow } from '../mappers';
import type { AiSummaryRecord } from '../mappers';
import type { AiSummaryInsert, AiSummaryRow } from '../rows';

const COLS = 'id,scope,symbol,summary_date,generator,provider,model,usage_id,body_version,body,input_ids,created_at';

/**
 * Replaces the summary of (scope, symbol, summary_date) or inserts it; every column is sent, so no stale value survives.
 * Writes no validation: core validates the body before the call. Returns the row id.
 */
export async function upsertAiSummary(db: Db, row: AiSummaryInsert): Promise<number> {
  const ctx = { table: 'ai_summaries', op: 'upsert' };
  const res = await db.from('ai_summaries').upsert(row, { onConflict: 'scope,symbol,summary_date' }).select('id');
  const data = unwrap<{ id: unknown }[]>(res, ctx);
  const first = data[0];
  if (!first) throw new DataError('DB_ERROR', ctx.table, ctx.op, 'no data returned');
  return mapRow((r: { id: unknown }) => toSafeInt(r.id, 'id', ctx.table), first, ctx);
}

/** All summaries (symbols and the portfolio) of one session date. A body that fails core validation maps to `body: null`. */
export async function listAiSummariesForDate(db: Db, date: string): Promise<AiSummaryRecord[]> {
  const ctx = { table: 'ai_summaries', op: 'list_for_date' };
  const res = await db.from('ai_summaries').select(COLS).eq('summary_date', date).order('symbol', { ascending: true });
  return unwrap<AiSummaryRow[]>(res, ctx).map((r) => mapRow(aiSummaryFromRow, r, ctx));
}
