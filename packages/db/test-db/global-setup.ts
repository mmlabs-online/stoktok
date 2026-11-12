import { join } from 'node:path';
import pg from 'pg';
import { runMigrations } from '../src/pg/migrate';
import { OWNER_ROLE, OWNER_ROLE_LOCK_KEY, ownerPassword, ownerRoleSql, ownerUrl } from './owner';

const ROOT = join(__dirname, '..', '..', '..');
const SUFFIX = String(process.pid);
const TEMPLATE = `stoktok_test_tpl_${SUFFIX}`;

/** Validates DB_TEST_URL: set, local host, and no query param that makes pg connect elsewhere. */
export function checkAdminUrl(raw: string | undefined): URL {
  if (!raw) {
    throw new Error('pnpm test:db needs DB_TEST_URL (localhost only), e.g. postgresql://postgres:postgres@localhost:5432/postgres');
  }
  const url = new URL(raw);
  // pg-connection-string lets ?host=, ?hostaddr= and ?port= override the URL authority.
  for (const k of ['host', 'hostaddr', 'port']) {
    if (url.searchParams.has(k)) throw new Error(`pnpm test:db refuses DB_TEST_URL with a '${k}' query parameter`);
  }
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

/** Creates the role if missing and always re-applies its attributes and password, under an advisory lock. Retried once on a concurrent create. */
async function ensureOwnerRole(adminUrl: string, admin: URL) {
  const once = () =>
    withClient(adminUrl, async (c) => {
      await c.query('begin');
      try {
        await c.query('select pg_advisory_xact_lock($1::bigint)', [OWNER_ROLE_LOCK_KEY]);
        const { rowCount } = await c.query('select 1 from pg_roles where rolname = $1', [OWNER_ROLE]);
        if (!rowCount) await c.query(`create role ${OWNER_ROLE}`);
        await c.query(ownerRoleSql(ownerPassword(admin)));
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => undefined);
        throw e;
      }
    });
  try {
    await once();
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== '42710' && code !== '23505') throw e;
    await once();
  }
}

export default async function setup() {
  let admin: URL;
  try {
    admin = checkAdminUrl(process.env.DB_TEST_URL);
  } catch (e) {
    // Vitest 5 loses the message of an error thrown from globalSetup (stack-map crash), so print it and exit.
    console.error((e as Error).message);
    process.exit(1);
  }
  // Test workers are separate processes: hand them this run's suffix.
  process.env.DB_TEST_SUFFIX = SUFFIX;
  const adminDb = admin.toString();
  await ensureOwnerRole(adminDb, admin);
  await withClient(adminDb, async (c) => {
    await c.query(`create database ${TEMPLATE} owner ${OWNER_ROLE}`);
  });
  const tplUrl = ownerUrl(admin, TEMPLATE);
  const cleanup = async () => {
    await withClient(adminDb, async (c) => {
      // `_` is a LIKE wildcard: escape it so another run's databases are never matched.
      const { rows } = await c.query<{ datname: string }>('select datname from pg_database where datname like $1', [`stoktok\\_test\\_%\\_${SUFFIX}`]);
      for (const { datname } of rows) {
        await c.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1', [datname]);
        await c.query(`drop database if exists "${datname}"`);
      }
    });
  };
  try {
    await withClient(withDb(admin, TEMPLATE), async (c) => {
      await c.query(`alter schema public owner to ${OWNER_ROLE}; revoke all on schema public from public;`);
    });
    await migrate(tplUrl);
  } catch (e) {
    console.error(`pnpm test:db setup failed: ${(e as Error).message}`);
    await cleanup().catch(() => undefined);
    process.exit(1);
  }
  return cleanup;
}

async function migrate(tplUrl: string) {
  await runMigrations({ connectionString: tplUrl, dir: join(ROOT, 'db/migrations') });
}
