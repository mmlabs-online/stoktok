/** Server-only (R3). Pool factory for the self-hosted Postgres; nothing here connects until the first query. */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { sqlstateOf } from '../errors';
import { PG_POOL_PROFILES, type PgProfile, type PoolProfile } from './config';
import type { Database } from './schema';
import { buildTypeParsers } from './types';

export const DATABASE_URL_ENV = 'STOKTOK_DATABASE_URL';

export interface PgPoolStats {
  total: number;
  idle: number;
  waiting: number;
}

/** Opaque: no pool and no URL on the handle. Kysely is reachable only through q() in ./access. */
export type PgDb = Readonly<{
  /** Drains the pool so a one-shot process can exit. Idempotent. */
  end(): Promise<void>;
  stats(): PgPoolStats;
}>;

/** Global registry symbol: survives duplicated module instances. For ./access only. */
export const INTERNALS = Symbol.for('stoktok.pgdb.internals');

export function createPgDb(
  env: Record<string, string | undefined>,
  profile: PgProfile,
  overrides: Partial<PoolProfile> = {},
): PgDb {
  const url = env[DATABASE_URL_ENV];
  if (!url) throw new Error(`Missing env ${DATABASE_URL_ENV}`);
  if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) throw new Error(`Invalid env ${DATABASE_URL_ENV}`);
  const p = { ...PG_POOL_PROFILES[profile], ...overrides };
  // Session settings via SET (not startup options) so they also work through a session pooler.
  // Run inside connect() so the pool never hands out (or queues a caller query on) a client whose setup failed.
  class SessionClient extends pg.Client {
    // pg-pool calls connect(cb); direct callers use the promise form.
    override connect(): Promise<pg.Client>;
    override connect(callback: ((err: Error) => void) | ((err: null, c: pg.Client) => void)): void;
    override connect(cb?: ((err: Error) => void) | ((err: null, c: pg.Client) => void)): Promise<pg.Client> | void {
      // A socket drop or backend termination during setup emits 'error' on the client: without a listener the
      // process crashes. pg-pool attaches its own listener synchronously inside cb, so removing ours right before cb is safe.
      const onErr = (e: unknown) => console.error(JSON.stringify({ event: 'db_session_setup_error', code: sqlstateOf(e) ?? null }));
      this.on('error', onErr);
      const done = this.initSession().then(() => this as pg.Client);
      if (!cb) return done.finally(() => this.off('error', onErr));
      const call = cb as (err: Error | null, c?: pg.Client) => void;
      void done.then(
        (c) => {
          this.off('error', onErr);
          call(null, c);
        },
        (e: Error) => {
          this.off('error', onErr);
          call(e);
        },
      );
    }

    private async initSession(): Promise<void> {
      await super.connect();
      try {
        await this.query(
          "select set_config('TimeZone','UTC',false), set_config('DateStyle','ISO, YMD',false), set_config('statement_timeout',$1,false), set_config('application_name',$2,false)",
          [String(p.statementTimeoutMs), p.applicationName],
        );
      } catch (e) {
        // Fail closed. Log the code only: messages can carry host and credentials.
        console.error(JSON.stringify({ event: 'db_session_init_failed', code: sqlstateOf(e) ?? null }));
        await Promise.resolve(this.end()).catch(() => undefined);
        // eslint-disable-next-line preserve-caught-error -- the cause message can carry host and credentials
        throw new Error('db session init failed');
      }
    }
  }
  const pool = new pg.Pool({
    Client: SessionClient,
    connectionString: url,
    max: p.max,
    idleTimeoutMillis: p.idleTimeoutMillis,
    connectionTimeoutMillis: p.connectionTimeoutMillis,
    types: buildTypeParsers(),
  });
  // Never log the message or the config: they can carry host and credentials.
  pool.on('error', (e) => console.error(JSON.stringify({ event: 'db_pool_error', code: sqlstateOf(e) ?? null })));
  const kysely = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  let ending: Promise<void> | undefined;
  const handle = {
    end: () => (ending ??= kysely.destroy()),
    stats: (): PgPoolStats => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }),
  };
  Object.defineProperty(handle, INTERNALS, { value: () => ({ kysely }), enumerable: false });
  return Object.freeze(handle);
}
