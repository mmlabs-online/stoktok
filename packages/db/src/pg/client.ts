/** Server-only (R3). Pool factory for the self-hosted Postgres; nothing here connects until the first query. */
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { sqlstateOf } from '../errors';
import { PG_POOL_PROFILES, type PgProfile, type PoolProfile } from './config';
import type { Database } from './schema';
import { buildTypeParsers } from './types';

export const DATABASE_URL_ENV = 'STOKTOK_DATABASE_URL';

export interface PgDb {
  kysely: Kysely<Database>;
  /** Drains the pool so a one-shot process can exit. */
  end(): Promise<void>;
  /** The underlying pool, exposed for tests (totalCount). */
  pool: pg.Pool;
}

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
      const done = this.initSession().then(() => this as pg.Client);
      if (!cb) return done;
      const call = cb as (err: Error | null, c?: pg.Client) => void;
      void done.then(
        (c) => call(null, c),
        (e: Error) => call(e),
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
  return { kysely, pool, end: () => kysely.destroy() };
}
