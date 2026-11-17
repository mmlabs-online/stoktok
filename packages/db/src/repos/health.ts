import { sql } from 'kysely';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';

/** Readiness probe: one round trip through the pool. Rejects with DataError (no host or password in the message). */
export async function pingDb(db: PgDb): Promise<void> {
  await q(db, { table: 'db', op: 'ping' }, (k) => sql`select 1`.execute(k));
}
