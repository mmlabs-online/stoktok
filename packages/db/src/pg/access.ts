/**
 * The only way to reach Kysely outside pg/. Do transactions inside `fn` and use only `trx` there.
 * Do not let `k` escape the callback.
 */
import type { Kysely } from 'kysely';
import { run, type Ctx, type SqlstateMap } from '../errors';
import { INTERNALS, type PgDb } from './client';
import type { Database } from './schema';

export function kyselyOf(db: PgDb): Kysely<Database> {
  const internals = (db as unknown as Record<symbol, (() => { kysely: Kysely<Database> }) | undefined>)[INTERNALS];
  if (typeof internals !== 'function') throw new Error('not a PgDb handle');
  return internals().kysely;
}

export function q<T>(db: PgDb, ctx: Ctx, fn: (k: Kysely<Database>) => Promise<T>, opts?: { map?: SqlstateMap }): Promise<T> {
  return run(ctx, () => fn(kyselyOf(db)), opts);
}
