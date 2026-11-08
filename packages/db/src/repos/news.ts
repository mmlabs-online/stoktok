import type { Db } from '../client';
import { unwrap } from '../errors';
import type { NewsInsert } from '../rows';

/**
 * Inserts new articles; a url already stored is skipped (first seen wins, ids stay stable). Existing rows are never read.
 * Chunks are sequential and each returns at most `chunkSize` ids, so a response stays under the PostgREST 1000-row cap.
 * Returns the number of rows actually inserted.
 */
export async function insertNews(db: Db, rows: readonly NewsInsert[], { chunkSize = 200 }: { chunkSize?: number } = {}): Promise<number> {
  const ctx = { table: 'news', op: 'insert' };
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const res = await db.from('news').upsert(rows.slice(i, i + chunkSize), { onConflict: 'url', ignoreDuplicates: true }).select('id');
    inserted += unwrap<unknown[]>(res, ctx).length;
  }
  return inserted;
}
