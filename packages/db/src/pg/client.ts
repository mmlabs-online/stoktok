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
  const pool = new pg.Pool({
    connectionString: url,
    max: p.max,
    idleTimeoutMillis: p.idleTimeoutMillis,
    connectionTimeoutMillis: p.connectionTimeoutMillis,
    types: buildTypeParsers(),
  });
  // Session settings via SET (not startup options) so they also work through a session pooler.
  pool.on('connect', (client) => {
    void client
      .query(
        "select set_config('TimeZone','UTC',false), set_config('DateStyle','ISO, YMD',false), set_config('statement_timeout',$1,false), set_config('application_name',$2,false)",
        [String(p.statementTimeoutMs), p.applicationName],
      )
      .catch((e: unknown) => {
        // Fail closed: a connection without the session settings must not serve queries. Log the code only.
        console.error(JSON.stringify({ event: 'db_session_init_failed', code: sqlstateOf(e) ?? null }));
        void Promise.resolve(client.end()).catch(() => undefined);
      });
  });
  // Never log the message or the config: they can carry host and credentials.
  pool.on('error', (e) => console.error(JSON.stringify({ event: 'db_pool_error', code: sqlstateOf(e) ?? null })));
  const kysely = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  return { kysely, end: () => kysely.destroy() };
}
