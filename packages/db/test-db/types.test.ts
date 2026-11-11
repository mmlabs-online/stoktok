import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { toSafeInt } from '@stoktok/core';
import { sql } from 'kysely';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

// Every udt_name used by a column in public. A new type must be added here with a parser decision.
const HANDLED = new Set(['uuid', 'int8', 'int4', 'int2', 'text', 'bool', 'date', '_date', 'timestamptz', 'jsonb', '_text', '_int2']);

describe('type parsing against real Postgres', () => {
  test('round-trips every column type used in public', async () => {
    const { rows } = await sql<Record<string, unknown>>`
      select
        '2026-11-10'::date as d,
        array['2026-11-10','2026-12-31']::date[] as da,
        '2026-11-10 08:00:00+00'::timestamptz as ts,
        '2026-11-10 08:00:00.123456+00'::timestamptz as tsu,
        '2026-11-10 15:00:00+07'::timestamptz as ts7,
        9007199254740991::int8 as big,
        '{"a":[1,2]}'::jsonb as j,
        '[1,2]'::jsonb as ja,
        array['A','B']::text[] as txt,
        array[1,2,3]::smallint[] as si,
        gen_random_uuid() as u,
        true as b,
        7::int4 as i`.execute(t.pgDb.kysely);
    const r = rows[0]!;
    expect(r.d).toBe('2026-11-10');
    expect(r.da).toEqual(['2026-11-10', '2026-12-31']);
    expect(r.ts).toBe('2026-11-10T08:00:00+00:00');
    expect(r.tsu).toBe('2026-11-10T08:00:00.123456+00:00');
    expect(r.ts7).toBe('2026-11-10T08:00:00+00:00');
    expect(r.big).toBe('9007199254740991');
    expect(toSafeInt(r.big, 'big')).toBe(9007199254740991);
    expect(r.j).toEqual({ a: [1, 2] });
    expect(r.ja).toEqual([1, 2]);
    expect(r.txt).toEqual(['A', 'B']);
    expect(r.si).toEqual([1, 2, 3]);
    expect(typeof r.u).toBe('string');
    expect(r.b).toBe(true);
    expect(r.i).toBe(7);
  });

  test('every public column type is in the handled set', async () => {
    const { rows } = await sql<{ udt_name: string }>`
      select distinct udt_name from information_schema.columns where table_schema = 'public'`.execute(t.pgDb.kysely);
    const unknown = rows.map((r) => r.udt_name).filter((u) => !HANDLED.has(u));
    expect(unknown).toEqual([]);
  });

  test('global pg.types is untouched', () => {
    expect(pg.types.getTypeParser(1082, 'text')('2026-11-10')).toBeInstanceOf(Date);
    expect(typeof pg.types.getTypeParser(1184, 'text')('2026-11-10 08:00:00+00')).not.toBe('string');
  });
});
