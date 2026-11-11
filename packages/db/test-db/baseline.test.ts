import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { freshDb, type TestDb } from './harness';

const BASELINE = join(__dirname, '..', '..', '..', 'db', 'migrations', '20261111000200_baseline.sql');

const TABLES = [
  'ai_keys', 'ai_summaries', 'ai_usage', 'assets', 'corporate_actions', 'data_gaps', 'financial_lines', 'financials',
  'lottery_draws', 'lottery_tickets', 'news', 'prices_daily', 'prices_intraday', 'settings', 'signals', 'symbols',
  'transactions', 'watchlist',
];

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

const col = async <T>(q: string, params: unknown[] = []): Promise<T[]> => (await c.query(q, params)).rows.map((r) => Object.values(r)[0] as T);

describe('baseline', () => {
  test('single-owner shape', async () => {
    expect(await col<string>("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1")).toEqual(TABLES);
    expect(await col<string>("select relname from pg_class where relnamespace = 'public'::regnamespace and (relrowsecurity or relforcerowsecurity)")).toEqual([]);
    expect(await col<string>("select policyname from pg_policies where schemaname = 'public'")).toEqual([]);
    expect(await col<string>('select extname from pg_extension order by 1')).toEqual(['plpgsql']);
    expect(await col<string>("select proname from pg_proc where pronamespace = 'public'::regnamespace order by 1")).toEqual(['ai_month_spend', 'ai_reserve']);
    expect(await col<boolean>("select prosecdef from pg_proc where pronamespace = 'public'::regnamespace")).toEqual([false, false]);
    const cfg = await col<string[]>("select proconfig from pg_proc where pronamespace = 'public'::regnamespace");
    for (const x of cfg) expect(x).toContain('search_path=""');
  });

  test('functions have no PUBLIC execute', async () => {
    const base = `select a.grantee from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.pronamespace = 'public'::regnamespace`;
    expect((await col<number>(base)).length).toBeGreaterThanOrEqual(1);
    expect(await col<number>(`${base} and a.grantee = 0`)).toEqual([]);
  });

  test('ai_keys keeps the STK-082 shape', async () => {
    const cols = (await c.query("select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'ai_keys' order by ordinal_position")).rows;
    expect(cols).toEqual([
      { column_name: 'provider', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'ciphertext', data_type: 'bytea', is_nullable: 'NO' },
      { column_name: 'iv', data_type: 'bytea', is_nullable: 'NO' },
      { column_name: 'auth_tag', data_type: 'bytea', is_nullable: 'NO' },
      { column_name: 'key_version', data_type: 'smallint', is_nullable: 'NO' },
      { column_name: 'last4', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
    ]);
    const ins = (p: string, ct: number, iv: number, tag: number, v: number | null, l4: string) =>
      c.query('insert into public.ai_keys (provider, ciphertext, iv, auth_tag, key_version, last4) values ($1, $2, $3, $4, $5, $6)', [p, Buffer.alloc(ct), Buffer.alloc(iv), Buffer.alloc(tag), v, l4]);
    const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code);
    expect(await code(ins('anthropic', 20, 12, 16, 1, 'abcd'))).toBe('ok');
    expect(await code(ins('google', 256, 12, 16, 1, 'abcd'))).toBe('ok');
    expect(await code(ins('openai', 20, 12, 16, 1, 'abcd'))).toBe('23514');
    expect(await code(ins('anthropic', 19, 12, 16, 1, 'abcd'))).toBe('23514');
    expect(await code(ins('anthropic', 257, 12, 16, 1, 'abcd'))).toBe('23514');
    expect(await code(ins('anthropic', 20, 11, 16, 1, 'abcd'))).toBe('23514');
    expect(await code(ins('anthropic', 20, 12, 17, 1, 'abcd'))).toBe('23514');
    expect(await code(ins('anthropic', 20, 12, 16, 0, 'abcd'))).toBe('23514');
    expect(await code(ins('anthropic', 20, 12, 16, 1, 'ab d'))).toBe('23514');
    expect(await code(ins('anthropic', 20, 12, 16, 1, 'abcé'))).toBe('23514');
    expect(await code(ins('anthropic', 20, 12, 16, null, 'abcd'))).toBe('23502');
    expect(await col<string>("select obj_description('public.ai_keys'::regclass, 'pg_class')")).not.toEqual([null]);
  });

  test('re-apply fails with 42P07 and changes nothing', async () => {
    const own = await freshDb();
    const k = new pg.Client({ connectionString: own.url });
    await k.connect();
    try {
      const counts = async () => (await k.query("select (select count(*) from pg_class where relnamespace = 'public'::regnamespace)::int as c, (select count(*) from pg_proc where pronamespace = 'public'::regnamespace)::int as p")).rows[0];
      const before = await counts();
      await k.query('begin');
      const err = await k.query(readFileSync(BASELINE, 'utf8')).then(() => undefined, (e: { code?: string }) => e);
      await k.query('rollback');
      expect(err?.code).toBe('42P07');
      expect(await counts()).toEqual(before);
    } finally {
      await k.end();
      await own.drop();
    }
  });
});
