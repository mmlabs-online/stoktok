import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { freshDb, type TestDb } from './harness';
import { compareSchema, parseSchemaTs, type DbColumnRow } from './schema-drift-parse';

const SCHEMA_TS = join(__dirname, '..', 'src', 'pg', 'schema.ts');

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

test('schema.ts matches information_schema (names and nullability, both directions)', async () => {
  const ts = parseSchemaTs(readFileSync(SCHEMA_TS, 'utf8'));
  expect(ts.size).toBe(18);
  const { rows } = await c.query<DbColumnRow>(
    `select c.table_name, c.column_name, c.is_nullable
       from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.table_name <> 'schema_migrations'`,
  );
  expect(new Set(rows.map((r) => r.table_name)).size).toBe(18);
  expect(compareSchema(ts, rows)).toEqual([]);
});
