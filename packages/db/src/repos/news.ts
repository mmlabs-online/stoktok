import { q } from '../pg/access';
import type { PgDb } from '../pg/client';
import { chunkRows, pickRows, upsertInto } from '../pg/upsert';
import type { NewsInsert } from '../rows';

const COLS = ['url', 'title', 'excerpt', 'source', 'credibility', 'published_at', 'fetched_at', 'symbols'] as const;

/**
 * Inserts new articles; a url already stored is skipped (first seen wins, ids stay stable). Existing rows are never read.
 * One statement per chunk, no transaction: an earlier chunk stays when a later one fails (the url key makes a retry safe).
 * Returns the number of rows actually inserted.
 */
export async function insertNews(db: PgDb, rows: readonly NewsInsert[], { chunkSize = 200 }: { chunkSize?: number } = {}): Promise<number> {
  const ctx = { table: 'news', op: 'insert' };
  let inserted = 0;
  for (const chunk of chunkRows(pickRows(rows, COLS), chunkSize)) {
    const ids = await q(db, ctx, (k) => upsertInto(k, 'news', chunk, ['url'], { ignoreDuplicates: true }).returning('id').execute());
    inserted += ids.length;
  }
  return inserted;
}
