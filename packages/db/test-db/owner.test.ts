import pg from 'pg';
import { describe, expect, test } from 'vitest';
import { emptyDb, freshDb } from './harness';
import { ensureOwnerRole, ownerPassword, TEST_OWNER_ROLE } from './owner';

const ADMIN = process.env.DB_TEST_URL as string;

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function identity(c: pg.Client) {
  const id = await c.query(
    `select current_user as cu, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
            (select datdba::regrole::text from pg_database where datname = current_database()) as datdba,
            (select nspowner::regrole::text from pg_namespace where nspname = 'public') as nsp,
            (select count(*)::int from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
              where n.nspname = 'public' and a.grantee = 0) as public_grants
       from pg_roles r where r.rolname = current_user`,
  );
  return id.rows[0];
}

describe('test:db owner role', () => {
  test('freshDb runs as the non-superuser owner', async () => {
    const t = await freshDb();
    try {
      const r = await withClient(t.url, identity);
      expect(r).toMatchObject({
        cu: TEST_OWNER_ROLE,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
        datdba: TEST_OWNER_ROLE,
        nsp: TEST_OWNER_ROLE,
        public_grants: 0,
      });
    } finally {
      await t.drop();
    }
  });

  test('template objects are owned by the owner', async () => {
    const t = await freshDb();
    try {
      await withClient(t.url, async (c) => {
        const cls = await c.query(
          `select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relowner <> current_user::regrole`,
        );
        const proc = await c.query(
          `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proowner <> current_user::regrole`,
        );
        const sm = await c.query(`select count(*)::int as n from pg_class where relname = 'schema_migrations' and relowner = current_user::regrole`);
        expect(cls.rows[0].n).toBe(0);
        expect(proc.rows[0].n).toBe(0);
        expect(sm.rows[0].n).toBe(1);
      });
    } finally {
      await t.drop();
    }
  });

  test('the owner cannot escalate', async () => {
    const t = await freshDb();
    try {
      await withClient(t.url, async (c) => {
        await expect(c.query('create role stoktok_test_zz')).rejects.toMatchObject({ code: '42501' });
        await expect(c.query('create database stoktok_test_zz')).rejects.toMatchObject({ code: '42501' });
      });
    } finally {
      await t.drop();
    }
  });

  test('emptyDb runs as the owner and can create tables', async () => {
    const t = await emptyDb();
    try {
      await withClient(t.url, async (c) => {
        expect(await identity(c)).toMatchObject({ cu: TEST_OWNER_ROLE, datdba: TEST_OWNER_ROLE, nsp: TEST_OWNER_ROLE, public_grants: 0 });
        await c.query('create table t (x int)');
        const r = await c.query(`select to_regclass('public.schema_migrations') as t`);
        expect(r.rows[0].t).toBeNull();
      });
    } finally {
      await t.drop();
    }
  });

  test('ensureOwnerRole is idempotent, concurrent-safe and repairs flags', async () => {
    const pw = ownerPassword(ADMIN);
    try {
      await withClient(ADMIN, (c) => c.query(`alter role ${TEST_OWNER_ROLE} createdb`));
      await Promise.all([withClient(ADMIN, (c) => ensureOwnerRole(c, pw)), withClient(ADMIN, (c) => ensureOwnerRole(c, pw))]);
      const r = await withClient(ADMIN, (c) => c.query('select rolcreatedb from pg_roles where rolname = $1', [TEST_OWNER_ROLE]));
      expect(r.rows[0].rolcreatedb).toBe(false);
      await withClient(ADMIN, (c) => c.query(`alter role ${TEST_OWNER_ROLE} set work_mem = '64MB'`));
      await withClient(ADMIN, (c) => ensureOwnerRole(c, pw));
      const s = await withClient(ADMIN, (c) => c.query('select rolconfig from pg_roles where rolname = $1', [TEST_OWNER_ROLE]));
      expect(s.rows[0].rolconfig).toBeNull();
      // Password still works: connect as the owner to a clone, never to the admin database.
      const t = await freshDb();
      try {
        await withClient(t.url, (c) => c.query('select 1'));
      } finally {
        await t.drop();
      }
    } finally {
      await withClient(ADMIN, (c) => ensureOwnerRole(c, pw));
    }
  });

  test('ensureOwnerRole refuses a role with memberships', async () => {
    const pw = ownerPassword(ADMIN);
    const m = `stoktok_test_m_${process.pid}`;
    await withClient(ADMIN, async (c) => {
      await c.query(`create role ${m} nologin`);
      await c.query(`grant ${m} to ${TEST_OWNER_ROLE}`);
    });
    try {
      await expect(withClient(ADMIN, (c) => ensureOwnerRole(c, pw))).rejects.toThrow(/member of another role/);
    } finally {
      await withClient(ADMIN, async (c) => {
        await c.query(`revoke ${m} from ${TEST_OWNER_ROLE}`);
        await c.query(`drop role ${m}`);
      });
      await withClient(ADMIN, (c) => ensureOwnerRole(c, pw));
    }
  });
});
