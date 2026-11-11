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
import type { AiKeyring } from '../keyring';
import { INTERNALS, type PgDb } from './client';
import type { Database } from './schema';

type Internals = { kysely: Kysely<Database>; keyring: AiKeyring };

function internalsOf(db: PgDb): Internals {
  const internals = (db as unknown as Record<symbol, (() => Internals) | undefined>)[INTERNALS];
  if (typeof internals !== 'function') throw new Error('not a PgDb handle');
  return internals();
}

export function kyselyOf(db: PgDb): Kysely<Database> {
  return internalsOf(db).kysely;
}

/** For repos/ai-keys.ts only (r3-guard): the AI key encryption keyring of this handle. */
export function keyringOf(db: PgDb): AiKeyring {
  return internalsOf(db).keyring;
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
