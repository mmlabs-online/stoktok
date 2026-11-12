import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { emptyDb, freshDb, type TestDb } from './harness';
import { OWNER_ROLE } from './owner';

let t: TestDb;
let c: pg.Client;

beforeAll(async () => {
  t = await freshDb();
  c = new pg.Client({ connectionString: t.url });
  await c.connect();
});

afterAll(async () => {
  await c.end();
  await t.drop();
});

const one = async <T>(q: string, params: unknown[] = []): Promise<T> => (await c.query(q, params)).rows[0] as T;

describe('owner role', () => {
  test('a clone connects as the non-superuser owner', async () => {
    const who = await one<{ cu: string; su: string }>('select current_user as cu, session_user as su');
    expect(who).toEqual({ cu: OWNER_ROLE, su: OWNER_ROLE });
    const r = await one<Record<string, boolean>>(
      'select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolcanlogin from pg_roles where rolname = $1',
      [OWNER_ROLE],
    );
    expect(r).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false, rolcanlogin: true });
    const m = await c.query('select 1 from pg_auth_members where member = $1::regrole', [OWNER_ROLE]);
    expect(m.rowCount).toBe(0);
  });

  test('the owner cannot create roles or databases', async () => {
    for (const sql of ['create role zz_stk089', 'create database zz_stk089']) {
      await expect(c.query(sql), sql).rejects.toMatchObject({ code: '42501' });
    }
  });

  test('template and clone are owned by the owner', async () => {
    const dbs = await c.query<{ own: string }>('select datdba::regrole::text as own from pg_database where datname in ($1, current_database())', [
      `stoktok_test_tpl_${process.env.DB_TEST_SUFFIX}`,
    ]);
    expect(dbs.rows.map((r) => r.own)).toEqual([OWNER_ROLE, OWNER_ROLE]);
    expect((await one<{ o: string }>(`select nspowner::regrole::text as o from pg_namespace where nspname = 'public'`)).o).toBe(OWNER_ROLE);
    const foreign = await c.query(
      `select 1 from pg_class where relnamespace = 'public'::regnamespace and relowner <> $1::regrole
       union all select 1 from pg_proc where pronamespace = 'public'::regnamespace and proowner <> $1::regrole`,
      [OWNER_ROLE],
    );
    expect(foreign.rowCount).toBe(0);
    const acl = await one<{ has_public: boolean }>(
      `select coalesce(bool_or(a.grantee = 0), false) as has_public from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a where n.nspname = 'public'`,
    );
    expect(acl.has_public).toBe(false);
  });

  test('emptyDb is owned by the owner', async () => {
    const e = await emptyDb();
    const ec = new pg.Client({ connectionString: e.url });
    await ec.connect();
    try {
      const r = await ec.query<{ cu: string; db: string; ns: string }>(
        `select current_user as cu, (select datdba::regrole::text from pg_database where datname = current_database()) as db,
                (select nspowner::regrole::text from pg_namespace where nspname = 'public') as ns`,
      );
      expect(r.rows[0]).toEqual({ cu: OWNER_ROLE, db: OWNER_ROLE, ns: OWNER_ROLE });
    } finally {
      await ec.end();
      await e.drop();
    }
  });
});
