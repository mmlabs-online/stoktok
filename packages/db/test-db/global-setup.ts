import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const ROOT = join(__dirname, '..', '..', '..');
const SUFFIX = String(process.pid);
const TEMPLATE = `stoktok_test_tpl_${SUFFIX}`;

function adminUrl(): URL {
  const raw = process.env.DB_TEST_URL;
  if (!raw) {
    throw new Error('pnpm test:db needs DB_TEST_URL (localhost only), e.g. postgresql://postgres:postgres@localhost:5432/postgres');
  }
  const url = new URL(raw);
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error(`pnpm test:db refuses non-local DB_TEST_URL host '${url.hostname}'`);
  }
  return url;
}

function withDb(url: URL, db: string): string {
  const u = new URL(url.toString());
  u.pathname = `/${db}`;
  return u.toString();
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

export default async function setup() {
  let admin: URL;
  try {
    admin = adminUrl();
  } catch (e) {
    // Vitest 5 loses the message of an error thrown from globalSetup (stack-map crash), so print it and exit.
    console.error((e as Error).message);
    process.exit(1);
  }
  // Test workers are separate processes: hand them this run's suffix.
  process.env.DB_TEST_SUFFIX = SUFFIX;
  const adminDb = admin.toString();
  await withClient(adminDb, async (c) => {
    await c.query(`create database ${TEMPLATE}`);
  });
  const tplUrl = withDb(admin, TEMPLATE);
  await withClient(tplUrl, async (c) => {
    const roles = readFileSync(join(ROOT, 'scripts/db-check/bootstrap-roles.sql'), 'utf8');
    await c.query(roles);
    const dir = join(ROOT, 'supabase/migrations');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
      await c.query(`begin;\n${readFileSync(join(dir, f), 'utf8')}\ncommit;`);
    }
  });

  return async () => {
    await withClient(adminDb, async (c) => {
      const { rows } = await c.query<{ datname: string }>('select datname from pg_database where datname like $1', [`stoktok_test_%_${SUFFIX}`]);
      for (const { datname } of rows) {
        await c.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1', [datname]);
        await c.query(`drop database if exists "${datname}"`);
      }
    });
  };
}
