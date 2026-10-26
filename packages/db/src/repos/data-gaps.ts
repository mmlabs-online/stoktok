import type { Db } from '../client';
import { mapRow, unwrap } from '../errors';
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

/** No `.select()`: supabase returns data: null on success. */
export async function insertGaps(db: Db, rows: readonly DataGapInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const res = await db.from('data_gaps').insert([...rows]);
  if (res.error) unwrap(res, { table: 'data_gaps', op: 'insert' });
}

export async function resolveGaps(db: Db, ids: readonly number[], resolvedAt: string): Promise<void> {
  if (ids.length === 0) return;
  const res = await db.from('data_gaps').update({ resolved_at: resolvedAt }).in('id', [...ids]);
  if (res.error) unwrap(res, { table: 'data_gaps', op: 'resolve' });
}
