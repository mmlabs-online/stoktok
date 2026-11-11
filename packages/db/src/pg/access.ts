/**
 * The only way to reach Kysely outside pg/. Do transactions inside `fn` and use only `trx` there.
 * Do not let `k` escape the callback.
 */
import type { Compilable, Kysely } from 'kysely';
import { run, type Ctx, type SqlstateMap } from '../errors';
import { INTERNALS, type PgDb } from './client';
import type { Database } from './schema';

export function kyselyOf(db: PgDb): Kysely<Database> {
  const internals = (db as unknown as Record<symbol, (() => { kysely: Kysely<Database> }) | undefined>)[INTERNALS];
  if (typeof internals !== 'function') throw new Error('not a PgDb handle');
  return internals().kysely;
}

/** Query builders and Kysely/Transaction handles must not leave the callback: they would run outside run(). */
type Escaping = Compilable<unknown> | Kysely<Database>;

export function q<T>(
  db: PgDb,
  ctx: Ctx,
  fn: (k: Kysely<Database>) => Promise<T extends Escaping ? never : T>,
  opts?: { map?: SqlstateMap },
): Promise<T> {
  return run(ctx, () => fn(kyselyOf(db)) as Promise<T>, opts);
}
