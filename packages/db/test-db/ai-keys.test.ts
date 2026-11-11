// Runs over the migrated template: the 20261111000100 shape (ciphertext columns, no Vault wrappers).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { DataError } from '../src/errors';
import { kyselyOf } from '../src/pg/access';
import { AI_KEYS_MASTER_KEY_ENV, createPgDb, DATABASE_URL_ENV, type PgDb } from '../src/pg/client';
import { deleteAiKey, listAiKeyMeta, readAiKeySecrets, saveAiKey } from '../src/repos/ai-keys';
import { freshDb, type TestDb } from './harness';

const K1 = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64');
const K2 = Buffer.from('fedcba9876543210fedcba9876543210').toString('base64');
const KEY_A = 'DUMMY-SENTINEL-anthropic-key-1234';
const KEY_G = 'DUMMY-SENTINEL-google-key-5678';

let t: TestDb;
const opened: PgDb[] = [];
/** A handle on the same database with the given master key (undefined = none). */
function withKey(master: string | undefined, url = t.url): PgDb {
  const env: Record<string, string | undefined> = { [DATABASE_URL_ENV]: url };
  if (master !== undefined) env[AI_KEYS_MASTER_KEY_ENV] = master;
  const db = createPgDb(env, 'worker');
  opened.push(db);
  return db;
}

async function caught(p: Promise<unknown>): Promise<DataError> {
  try {
    await p;
  } catch (e) {
    return e as DataError;
  }
  throw new Error('expected rejection');
}

async function rowCount(db: PgDb): Promise<number> {
  const r = await sql<{ n: string }>`select count(*)::text as n from ai_keys`.execute(kyselyOf(db));
  return Number(r.rows[0]!.n);
}

beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await Promise.all(opened.map((d) => d.end().catch(() => undefined)));
  await t.drop();
});
beforeEach(async () => {
  await sql`delete from ai_keys`.execute(kyselyOf(t.pgDb));
});

describe('ai keys repo', () => {
  test('round trip: save both, list shows last4 and no secret, read decrypts; replace updates last4, iv and updated_at; delete true then false', async () => {
    const db = withKey(K1);
    const meta = await saveAiKey(db, 'anthropic', KEY_A);
    expect(meta).toMatchObject({ provider: 'anthropic', last4: '1234' });
    expect(typeof meta.updatedAt).toBe('string');
    await saveAiKey(db, 'google', KEY_G);
    const listed = await listAiKeyMeta(db);
    expect(listed.map((m) => [m.provider, m.last4]).sort()).toEqual([['anthropic', '1234'], ['google', '5678']]);
    expect(JSON.stringify(listed)).not.toContain('SENTINEL');
    expect(await readAiKeySecrets(db)).toEqual({ anthropic: KEY_A, google: KEY_G });

    const before = await sql<{ iv: Buffer; updated_at: string }>`select iv, updated_at from ai_keys where provider = 'anthropic'`.execute(kyselyOf(db));
    await new Promise((r) => setTimeout(r, 10));
    const replaced = await saveAiKey(db, 'anthropic', 'DUMMY-SENTINEL-anthropic-key-9999');
    expect(replaced.last4).toBe('9999');
    const after = await sql<{ iv: Buffer; updated_at: string }>`select iv, updated_at from ai_keys where provider = 'anthropic'`.execute(kyselyOf(db));
    expect(after.rows[0]!.iv.equals(before.rows[0]!.iv)).toBe(false);
    expect(after.rows[0]!.updated_at > before.rows[0]!.updated_at).toBe(true);
    expect(await readAiKeySecrets(db)).toEqual({ anthropic: 'DUMMY-SENTINEL-anthropic-key-9999', google: KEY_G });

    expect(await deleteAiKey(db, 'google')).toBe(true);
    expect(await deleteAiKey(db, 'google')).toBe(false);
    expect(await readAiKeySecrets(db)).toEqual({ anthropic: 'DUMMY-SENTINEL-anthropic-key-9999' });
  });

  test('the stored row never contains the plaintext (bytes, hex or text)', async () => {
    const db = withKey(K1);
    await saveAiKey(db, 'google', KEY_G);
    const k = kyselyOf(db);
    const pos = await sql<{ p: number }>`select position(convert_to(${KEY_G}, 'UTF8') in ciphertext) as p from ai_keys where provider = 'google'`.execute(k);
    expect(pos.rows[0]!.p).toBe(0);
    const text = await sql<{ t: string }>`select ai_keys::text as t from ai_keys where provider = 'google'`.execute(k);
    expect(text.rows[0]!.t).not.toContain('SENTINEL');
    expect(text.rows[0]!.t).not.toContain(Buffer.from(KEY_G).toString('hex'));
  });

  test('saving the same key twice gives a different iv and ciphertext', async () => {
    const db = withKey(K1);
    const k = kyselyOf(db);
    const read = async () => (await sql<{ iv: Buffer; ciphertext: Buffer }>`select iv, ciphertext from ai_keys where provider = 'google'`.execute(k)).rows[0]!;
    await saveAiKey(db, 'google', KEY_G);
    const a = await read();
    await saveAiKey(db, 'google', KEY_G);
    const b = await read();
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });
});

describe('fail closed', () => {
  test('no rows and no master key: readAiKeySecrets returns {} (env fallback)', async () => {
    expect(await readAiKeySecrets(withKey(undefined))).toEqual({});
    expect(await readAiKeySecrets(withKey('not-a-key'))).toEqual({});
  });

  test('rows and no master key, or an invalid one: NOT_CONFIGURED', async () => {
    await saveAiKey(withKey(K1), 'google', KEY_G);
    for (const master of [undefined, 'not-a-key']) {
      const e = await caught(readAiKeySecrets(withKey(master)));
      expect(e).toMatchObject({ code: 'NOT_CONFIGURED' });
      expect(String(e) + JSON.stringify(e)).not.toContain('SENTINEL');
    }
  });

  test('rows and a wrong master key: MAPPING, no result', async () => {
    await saveAiKey(withKey(K1), 'google', KEY_G);
    const e = await caught(readAiKeySecrets(withKey(K2)));
    expect(e).toMatchObject({ code: 'MAPPING' });
    expect(e.cause).toBeUndefined();
  });

  test('provider swap (anthropic ciphertext, iv and tag copied into google): the whole read rejects, no partial map', async () => {
    const db = withKey(K1);
    await saveAiKey(db, 'anthropic', KEY_A);
    await saveAiKey(db, 'google', KEY_G);
    await sql`update ai_keys g set ciphertext = a.ciphertext, iv = a.iv, auth_tag = a.auth_tag, last4 = a.last4 from ai_keys a where a.provider = 'anthropic' and g.provider = 'google'`.execute(kyselyOf(db));
    expect(await caught(readAiKeySecrets(db))).toMatchObject({ code: 'MAPPING' });
  });

  test('one tampered row makes the whole read reject', async () => {
    const db = withKey(K1);
    await saveAiKey(db, 'anthropic', KEY_A);
    await saveAiKey(db, 'google', KEY_G);
    await sql`update ai_keys set auth_tag = decode(repeat('00', 16), 'hex') where provider = 'google'`.execute(kyselyOf(db));
    expect(await caught(readAiKeySecrets(db))).toMatchObject({ code: 'MAPPING' });
  });

  test('key_version set to 2 via SQL: the read rejects', async () => {
    const db = withKey(K1);
    await saveAiKey(db, 'google', KEY_G);
    await sql`update ai_keys set key_version = 2`.execute(kyselyOf(db));
    expect(await caught(readAiKeySecrets(db))).toMatchObject({ code: 'MAPPING' });
  });

  test('last4 edited via SQL so it no longer matches the decrypted key: MAPPING', async () => {
    const db = withKey(K1);
    await saveAiKey(db, 'google', KEY_G);
    await sql`update ai_keys set last4 = 'zzzz'`.execute(kyselyOf(db));
    expect(await caught(readAiKeySecrets(db))).toMatchObject({ code: 'MAPPING' });
  });

  test('saveAiKey with no or an invalid master key: NOT_CONFIGURED and nothing is written', async () => {
    for (const master of [undefined, 'not-a-key']) {
      const db = withKey(master);
      const e = await caught(saveAiKey(db, 'google', KEY_G));
      expect(e).toMatchObject({ code: 'NOT_CONFIGURED' });
      expect(String(e) + JSON.stringify(e)).not.toContain('SENTINEL');
      expect(await rowCount(db)).toBe(0);
    }
  });

  test('deleteAiKey and listAiKeyMeta work on a handle with no master key', async () => {
    await saveAiKey(withKey(K1), 'google', KEY_G);
    const none = withKey(undefined);
    expect((await listAiKeyMeta(none)).map((m) => m.provider)).toEqual(['google']);
    expect(await deleteAiKey(none, 'google')).toBe(true);
    expect(await rowCount(none)).toBe(0);
  });

  test('two parallel saves for one provider leave exactly one row that decrypts to one of the two keys', async () => {
    const db = withKey(K1);
    const k1 = 'DUMMY-SENTINEL-parallel-key-1111';
    const k2 = 'DUMMY-SENTINEL-parallel-key-2222';
    await Promise.all([saveAiKey(db, 'google', k1), saveAiKey(db, 'google', k2)]);
    expect(await rowCount(db)).toBe(1);
    expect([k1, k2]).toContain((await readAiKeySecrets(db)).google);
  });
});

describe('errors and ended handle', () => {
  test('a DB constraint violation on save is VALIDATION 23514; message and JSON hold neither the key nor its last4; no cause', async () => {
    const own = await freshDb();
    try {
      await sql`alter table ai_keys add constraint ai_keys_test_reject check (false)`.execute(kyselyOf(own.pgDb));
      const key = 'DUMMY-SENTINEL-zzzz-key-4321';
      const e = await caught(saveAiKey(withKey(K1, own.url), 'google', key));
      expect(e).toBeInstanceOf(DataError);
      expect(e).toMatchObject({ code: 'VALIDATION', pgCode: '23514' });
      const text = `${e.message}${JSON.stringify(e)}${String(e)}`;
      expect(text).not.toContain('SENTINEL');
      expect(text).not.toContain('4321');
      expect(e.cause).toBeUndefined();
    } finally {
      await own.drop();
    }
  });

  test('ended handle: every ai-keys function rejects with DataError DB_ERROR', async () => {
    const dead = await freshDb();
    const keyed = createPgDb({ [DATABASE_URL_ENV]: dead.url, [AI_KEYS_MASTER_KEY_ENV]: K1 }, 'worker');
    await listAiKeyMeta(keyed); // a pool that never ran a query is not initialised, so end() would be a no-op
    await keyed.end();
    for (const call of [
      () => saveAiKey(keyed, 'google', KEY_G),
      () => deleteAiKey(keyed, 'google'),
      () => listAiKeyMeta(keyed),
      () => readAiKeySecrets(keyed),
    ]) {
      const e = await call().then(() => undefined, (x: unknown) => x);
      expect(e).toBeInstanceOf(DataError);
      expect(e).toMatchObject({ code: 'DB_ERROR' });
      expect(String(e)).not.toContain('SENTINEL');
    }
    await dead.drop();
  });
});

describe('migration guard', () => {
  test('refuses a database with a real (non-stub) Vault and leaves ai_keys unchanged', async () => {
    const own = await freshDb();
    const file = readFileSync(join(__dirname, '..', '..', '..', 'supabase', 'migrations', '20261111000100_ai_keys_app_encryption.sql'), 'utf8');
    const c = new pg.Client({ connectionString: own.url });
    await c.connect();
    try {
      await c.query("comment on schema vault is 'x'");
      await c.query('begin');
      const err = await c.query(file).then(() => undefined, (e: Error) => e);
      await c.query('rollback');
      expect(err?.message).toContain('refusing');
      const cols = await c.query("select column_name from information_schema.columns where table_name = 'ai_keys' and column_name = 'ciphertext'");
      expect(cols.rowCount).toBe(1);
    } finally {
      await c.end();
      await own.drop();
    }
  });
});
