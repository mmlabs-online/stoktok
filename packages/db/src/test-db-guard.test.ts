import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { checkAdminUrl } from '../test-db/global-setup';
import {
  asOwner,
  ensureOwnerRole,
  OWNER_PASSWORD_LABEL,
  OWNER_ROLE_LOCK_KEY,
  ownerPassword,
  TEST_OWNER_ROLE,
  type QueryClient,
} from '../test-db/owner';
import { MIGRATION_LOCK_KEY } from './pg/migrate';

describe('test:db DB_TEST_URL guard', () => {
  test('accepts a local URL, including a port in the authority', () => {
    expect(checkAdminUrl('postgresql://postgres@127.0.0.1:54329/postgres').hostname).toBe('127.0.0.1');
    expect(checkAdminUrl('postgresql://postgres:pw@localhost/postgres').hostname).toBe('localhost');
  });

  test('refuses a missing URL and a non-local host', () => {
    expect(() => checkAdminUrl(undefined)).toThrow(/needs DB_TEST_URL/);
    expect(() => checkAdminUrl('postgresql://postgres@example.com/postgres')).toThrow(/refuses non-local/);
  });

  test('refuses host, hostaddr and port query params that override the URL host', () => {
    for (const q of ['host=prod.example', 'hostaddr=10.0.0.5', 'port=5432']) {
      expect(() => checkAdminUrl(`postgresql://postgres:pw@localhost/postgres?${q}`), q).toThrow(/query parameter/);
    }
  });
});

const ADMIN = 'postgresql://postgres:postgres@localhost:5432/postgres';

describe('ownerPassword', () => {
  test('deterministic 64-hex', () => {
    expect(ownerPassword(ADMIN)).toBe(ownerPassword(ADMIN));
    expect(ownerPassword(ADMIN)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('changes with the admin password, not with host/path/query', () => {
    expect(ownerPassword('postgresql://postgres:pw1@localhost:5432/postgres')).not.toBe(ownerPassword('postgresql://postgres:pw2@localhost:5432/postgres'));
    expect(ownerPassword('postgresql://postgres:pw1@localhost:5432/postgres')).toBe(
      ownerPassword('postgresql://postgres:pw1@127.0.0.1:5433/stoktok_test_3_99?application_name=x'),
    );
  });

  test('percent-decoded; no password still gives 64 hex', () => {
    expect(ownerPassword('postgresql://postgres:p%40ss%3Aw@localhost/postgres')).toBe(
      createHash('sha256')
        .update(OWNER_PASSWORD_LABEL + 'p@ss:w')
        .digest('hex'),
    );
    expect(ownerPassword('postgresql://postgres@localhost/postgres')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('asOwner', () => {
  test('swaps userinfo, keeps host, port, database and query', () => {
    const input = 'postgresql://postgres:secret-ADMIN@localhost:5433/stoktok_test_1_42?application_name=x';
    const out = asOwner(input);
    const u = new URL(out);
    expect(u.username).toBe(TEST_OWNER_ROLE);
    expect(u.password).toBe(ownerPassword(input));
    expect(u.hostname).toBe('localhost');
    expect(u.port).toBe('5433');
    expect(u.pathname).toBe('/stoktok_test_1_42');
    expect(u.search).toBe('?application_name=x');
    expect(out).not.toContain('secret-ADMIN');
  });
});

function fakeClient(script: { lookup: unknown[][]; members?: number; create?: { code: string }[] }) {
  const log: { text: string; params?: unknown[] }[] = [];
  const lookups = [...script.lookup];
  const creates = [...(script.create ?? [])];
  const client: QueryClient = {
    async query(text, params) {
      log.push({ text, params });
      if (text.startsWith('select 1 from pg_roles')) return { rows: lookups.shift() ?? [] };
      if (text.startsWith('create role')) {
        const err = creates.shift();
        if (err) throw err;
      }
      if (text.includes('pg_auth_members')) return { rows: [{ n: script.members ?? 0 }] };
      return { rows: [] };
    },
  };
  return { client, log, texts: () => log.map((l) => l.text) };
}

const PW = 'a'.repeat(64);
const ATTRS = 'login nosuperuser nocreatedb nocreaterole noreplication nobypassrls';

describe('ensureOwnerRole', () => {
  test('rejects a bad password before any query', async () => {
    for (const bad of ['', 'a'.repeat(63), 'A'.repeat(64), `a'; drop role x; --`.padEnd(64, 'a')]) {
      const f = fakeClient({ lookup: [] });
      await expect(ensureOwnerRole(f.client, bad)).rejects.toThrow(/64 lowercase hex/);
      expect(f.log).toHaveLength(0);
    }
  });

  test('create path', async () => {
    const f = fakeClient({ lookup: [[]] });
    await ensureOwnerRole(f.client, PW);
    const t = f.texts();
    expect(t[0]).toBe('begin');
    expect(t[1]).toBe('select pg_advisory_xact_lock($1::bigint)');
    expect(f.log[1]?.params).toEqual([OWNER_ROLE_LOCK_KEY]);
    expect(t[2]).toMatch(/^select 1 from pg_roles/);
    expect(t[3]).toBe(`create role ${TEST_OWNER_ROLE} ${ATTRS} password '${PW}'`);
    expect(t[4]).toMatch(/pg_auth_members/);
    expect(t[5]).toBe('commit');
  });

  test('alter path re-asserts the NO* flags', async () => {
    const f = fakeClient({ lookup: [[{ '?column?': 1 }]] });
    await ensureOwnerRole(f.client, PW);
    const t = f.texts();
    expect(t).toContain(`alter role ${TEST_OWNER_ROLE} with ${ATTRS} password '${PW}'`);
    expect(t.some((x) => x.startsWith('create role'))).toBe(false);
    expect(t.some((x) => x.includes('drop role'))).toBe(false);
  });

  test('42710 / 23505 roll back and retry once', async () => {
    for (const code of ['42710', '23505']) {
      const f = fakeClient({ lookup: [[], [{ x: 1 }]], create: [{ code }] });
      await ensureOwnerRole(f.client, PW);
      const t = f.texts();
      expect(t.filter((x) => x === 'begin')).toHaveLength(2);
      expect(t).toContain('rollback');
      expect(t.some((x) => x.startsWith('alter role'))).toBe(true);
      expect(t.at(-1)).toBe('commit');
    }
    const twice = fakeClient({ lookup: [[], []], create: [{ code: '42710' }, { code: '42710' }] });
    await expect(ensureOwnerRole(twice.client, PW)).rejects.toMatchObject({ code: '42710' });
    const other = fakeClient({ lookup: [[]], create: [{ code: '42501' }] });
    await expect(ensureOwnerRole(other.client, PW)).rejects.toMatchObject({ code: '42501' });
    expect(other.texts().filter((x) => x === 'begin')).toHaveLength(1);
    expect(other.texts()).toContain('rollback');
  });

  test('memberships fail closed', async () => {
    const f = fakeClient({ lookup: [[]], members: 1 });
    await expect(ensureOwnerRole(f.client, PW)).rejects.toThrow(/member of another role/);
    expect(f.texts()).toContain('rollback');
    expect(f.texts()).not.toContain('commit');
  });
});

describe('owner role vs db:check', () => {
  test('owner role lock key differs from MIGRATION_LOCK_KEY', () => {
    expect(OWNER_ROLE_LOCK_KEY).not.toBe(MIGRATION_LOCK_KEY);
    expect(OWNER_ROLE_LOCK_KEY).toMatch(/^[0-9]+$/);
    expect(BigInt(OWNER_ROLE_LOCK_KEY) > 2n ** 31n).toBe(true);
  });

  test("test owner role never trips db:check's refusal", () => {
    const sh = readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'db-check.sh'), 'utf8');
    const names = [/^APP="\$\{DB_CHECK_APP:-([a-z0-9_]+)\}"$/m, /^NOBODY=([a-z0-9_]+)$/m, /^CANARY_ROLE=([a-z0-9_]+)$/m].map((re) => {
      const m = re.exec(sh);
      expect(m, String(re)).not.toBeNull();
      return m?.[1];
    });
    for (const n of names) expect(TEST_OWNER_ROLE).not.toBe(n);
  });
});
