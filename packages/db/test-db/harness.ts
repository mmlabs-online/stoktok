import pg from 'pg';
import { createPgDb, DATABASE_URL_ENV, type PgDb } from '../src/pg/client';
import type { PgProfile } from '../src/pg/config';

const SUFFIX = process.env.DB_TEST_SUFFIX as string;
let n = 0;

function adminUrl(): URL {
  return new URL(process.env.DB_TEST_URL as string);
}

function withDb(db: string): string {
  const u = adminUrl();
  u.pathname = `/${db}`;
  return u.toString();
}

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: adminUrl().toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export interface TestDb {
  pgDb: PgDb;
  url: string;
  drop(): Promise<void>;
}

/** Clones the migrated template into a fresh database. */
export async function freshDb(profile: PgProfile = 'worker'): Promise<TestDb> {
  const name = `stoktok_test_${++n}_${SUFFIX}`;
  await admin((c) => c.query(`create database ${name} template stoktok_test_tpl_${SUFFIX}`));
  const url = withDb(name);
  const pgDb = createPgDb({ [DATABASE_URL_ENV]: url }, profile);
  return {
    pgDb,
    url,
    drop: async () => {
      await pgDb.end().catch(() => undefined);
      await admin(async (c) => {
        await c.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1', [name]);
        await c.query(`drop database if exists ${name}`);
      });
    },
  };
}

/** An empty database (no template, no schema_migrations). Named so the global-setup cleanup sweep matches it. */
export async function emptyDb(): Promise<{ url: string; drop(): Promise<void> }> {
  const name = `stoktok_test_${++n}_${SUFFIX}`;
  await admin((c) => c.query(`create database ${name}`));
  return {
    url: withDb(name),
    drop: async () => {
      await admin(async (c) => {
        await c.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1', [name]);
        await c.query(`drop database if exists ${name}`);
      });
    },
  };
}
