import type { GapResolvedReason } from '@stoktok/core';
import type { Db } from '../client';
import { fetchAll, mapRow, unwrap } from '../errors';
import { openGapFromRow } from '../mappers';
import type { OpenGapRecord } from '../mappers';
import type { DataGapInsert, OpenGapRow } from '../rows';

/** Unresolved gaps of one data type for the symbols. Gaps are never deleted, only resolved. */
export async function listOpenGaps(db: Db, dataType: string, symbols: readonly string[]): Promise<OpenGapRecord[]> {
  if (symbols.length === 0) return [];
  const ctx = { table: 'data_gaps', op: 'list_open' };
  const rows = unwrap<OpenGapRow[]>(
    await db
      .from('data_gaps')
      .select('id,symbol,from_ts,to_ts')
      .eq('data_type', dataType)
      .in('symbol', [...symbols])
      .is('resolved_at', null),
    ctx,
  );
  return rows.map((r) => mapRow(openGapFromRow, r, ctx));
}

/** Unresolved market-wide gaps (symbol IS NULL) of one data type; `listOpenGaps` filters by symbol and misses them. */
export async function listOpenMarketGaps(db: Db, dataType: string): Promise<OpenGapRecord[]> {
  const ctx = { table: 'data_gaps', op: 'list_open_market' };
  const rows = unwrap<OpenGapRow[]>(
    await db.from('data_gaps').select('id,symbol,from_ts,to_ts').eq('data_type', dataType).is('symbol', null).is('resolved_at', null),
    ctx,
  );
  return rows.map((r) => mapRow(openGapFromRow, r, ctx));
}

/** Every unresolved gap of one data type, any symbol (including NULL), paged past the PostgREST row cap. `source` narrows it to one source. */
export async function listAllOpenGaps(db: Db, dataType: string, opts: { pageSize?: number; source?: string } = {}): Promise<OpenGapRecord[]> {
  const ctx = { table: 'data_gaps', op: 'list_all_open' };
  const rows = await fetchAll<OpenGapRow>(
    (from, to) => {
      let q = db.from('data_gaps').select('id,symbol,from_ts,to_ts').eq('data_type', dataType);
      if (opts.source !== undefined) q = q.eq('source', opts.source);
      return q.is('resolved_at', null).order('id', { ascending: true }).range(from, to);
    },
    ctx,
    opts.pageSize,
  );
  return rows.map((r) => mapRow(openGapFromRow, r, ctx));
}

/** No `.select()`: supabase returns data: null on success. */
export async function insertGaps(db: Db, rows: readonly DataGapInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const res = await db.from('data_gaps').insert([...rows]);
  if (res.error) unwrap(res, { table: 'data_gaps', op: 'insert' });
}

/** Only unresolved rows: a rerun never overwrites an earlier resolved_at. `reason` is written only when given. */
export async function resolveGaps(db: Db, ids: readonly number[], resolvedAt: string, reason?: GapResolvedReason): Promise<void> {
  if (ids.length === 0) return;
  const patch = reason === undefined ? { resolved_at: resolvedAt } : { resolved_at: resolvedAt, resolved_reason: reason };
  const res = await db.from('data_gaps').update(patch).in('id', [...ids]).is('resolved_at', null);
  if (res.error) unwrap(res, { table: 'data_gaps', op: 'resolve' });
}

/** Moves the end of still-open gaps forward (a continuing outage is one row). Resolved rows are never touched. */
export async function extendGaps(db: Db, ids: readonly number[], toTs: string): Promise<void> {
  if (ids.length === 0) return;
  const res = await db.from('data_gaps').update({ to_ts: toTs }).in('id', [...ids]).is('resolved_at', null);
  if (res.error) unwrap(res, { table: 'data_gaps', op: 'extend' });
}
