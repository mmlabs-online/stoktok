// remove in STK-082: runs over the Vault stub (scripts/db-check/bootstrap-roles.sql), not real Vault.
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DataError } from '../src/errors';
import { kyselyOf } from '../src/pg/access';
import { deleteAiKey, listAiKeyMeta, readAiKeySecrets, saveAiKey } from '../src/repos/ai-keys';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

const KEY_A = 'DUMMY-SENTINEL-anthropic-key-1234';
const KEY_G = 'DUMMY-SENTINEL-google-key-5678';

describe('ai keys repo', () => {
  test('set then list shows last4 and no secret; replace updates last4; delete true then false; readAiKeySecrets round-trips both providers', async () => {
    const meta = await saveAiKey(t.pgDb, 'anthropic', KEY_A);
    expect(meta).toMatchObject({ provider: 'anthropic', last4: '1234' });
    expect(typeof meta.updatedAt).toBe('string');
    await saveAiKey(t.pgDb, 'google', KEY_G);
    const listed = await listAiKeyMeta(t.pgDb);
    expect(listed.map((m) => [m.provider, m.last4]).sort()).toEqual([['anthropic', '1234'], ['google', '5678']]);
    expect(JSON.stringify(listed)).not.toContain('SENTINEL');
    expect((await saveAiKey(t.pgDb, 'anthropic', 'DUMMY-SENTINEL-anthropic-key-9999')).last4).toBe('9999');
    expect(await readAiKeySecrets(t.pgDb)).toEqual({ anthropic: 'DUMMY-SENTINEL-anthropic-key-9999', google: KEY_G });
    expect(await deleteAiKey(t.pgDb, 'google')).toBe(true);
    expect(await deleteAiKey(t.pgDb, 'google')).toBe(false);
    expect(await readAiKeySecrets(t.pgDb)).toEqual({ anthropic: 'DUMMY-SENTINEL-anthropic-key-9999' });
  });

  test('a 22023 from ai_key_set → VALIDATION; message and JSON.stringify(error) contain neither the key nor its last4', async () => {
    // The key passes the format check but the database function rejects it (22023): drop the function's accepted shape.
    const k = kyselyOf(t.pgDb);
    await sql`create or replace function public.ai_key_set(p_provider text, p_key text) returns table (key_last4 text, saved_at timestamptz) language plpgsql as $$ begin raise exception 'rejected' using errcode = '22023'; end $$`.execute(k);
    const key = 'DUMMY-SENTINEL-zzzz-key-4321';
    const e = await saveAiKey(t.pgDb, 'google', key).then(() => undefined, (x: unknown) => x);
    expect(e).toBeInstanceOf(DataError);
    expect(e).toMatchObject({ code: 'VALIDATION', pgCode: '22023' });
    const text = `${String((e as Error).message)}${JSON.stringify(e)}${String(e)}`;
    expect(text).not.toContain('SENTINEL');
    expect(text).not.toContain('4321');
    expect((e as DataError).cause).toBeUndefined();
  });

  test('ended handle: every ai-keys function rejects with DataError', async () => {
    const dead = await freshDb();
    await listAiKeyMeta(dead.pgDb); // a pool that never ran a query is not initialised, so end() would be a no-op
    await dead.pgDb.end();
    for (const call of [() => saveAiKey(dead.pgDb, 'google', KEY_G), () => deleteAiKey(dead.pgDb, 'google'), () => listAiKeyMeta(dead.pgDb), () => readAiKeySecrets(dead.pgDb)]) {
      const e = await call().then(() => undefined, (x: unknown) => x);
      expect(e).toBeInstanceOf(DataError);
      expect(e).toMatchObject({ code: 'DB_ERROR' });
      expect(String(e)).not.toContain('SENTINEL');
    }
    await dead.drop();
  });
});
