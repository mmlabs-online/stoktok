/**
 * The only way to reach Kysely outside pg/. Do transactions inside `fn` and use only `trx` there.
 * Do not let `k` escape the callback.
 */
import type {
  Compilable,
  ConnectionBuilder,
  DatabaseIntrospector,
  Kysely,
  QueryCreator,
  TransactionBuilder,
} from 'kysely';
import { run, type Ctx, type SqlstateMap } from '../errors';
import { INTERNALS, type PgDb } from './client';
import type { Database } from './schema';

export function kyselyOf(db: PgDb): Kysely<Database> {
  const internals = (db as unknown as Record<symbol, (() => { kysely: Kysely<Database> }) | undefined>)[INTERNALS];
  if (typeof internals !== 'function') throw new Error('not a PgDb handle');
  return internals().kysely;
}

/**
 * Query builders, Kysely/Transaction handles and the things reachable from them (transaction(), connection(), with(),
 * introspection) must not leave the callback: they would run outside run().
 */
type Escaping =
  | Compilable<unknown>
  | Kysely<Database>
  | QueryCreator<Database>
  | TransactionBuilder<Database>
  | ConnectionBuilder<Database>
  | DatabaseIntrospector;

/** `any` is rejected too: it would defeat the Escaping check. */
type NoEscape<T> = 0 extends 1 & T ? never : T extends Escaping ? never : T;

export function q<T>(
  db: PgDb,
  ctx: Ctx,
  fn: (k: Kysely<Database>) => Promise<NoEscape<T>>,
  opts?: { map?: SqlstateMap },
): Promise<T> {
  return run(ctx, () => fn(kyselyOf(db)) as Promise<T>, opts);
}
