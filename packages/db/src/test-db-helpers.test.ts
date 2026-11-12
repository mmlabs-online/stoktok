import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { OWNER_ROLE, ownerPassword, ownerRoleSql, ownerUrl } from '../test-db/owner';
import { compareSchema, isNullableType, parseSchemaTs } from '../test-db/schema-drift-parse';

const SCHEMA_TS = join(__dirname, 'pg', 'schema.ts');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('owner role', () => {
  test('name and flags', () => {
    expect(OWNER_ROLE).toBe('stoktok_test_owner');
    expect(OWNER_ROLE).toMatch(/^[a-z_]+$/);
    expect(['stoktok', 'stoktok_nobody', 'dbcheck_canary', 'postgres']).not.toContain(OWNER_ROLE);
    expect(OWNER_ROLE.startsWith('pg_')).toBe(false);
  });

  test('password derivation', () => {
    const a = 'postgresql://postgres:secret@localhost:5432/postgres';
    const p = ownerPassword(a);
    expect(ownerPassword(a)).toBe(p);
    expect(p).toMatch(/^[0-9a-f]{64}$/);
    expect(ownerPassword('postgresql://postgres:other@localhost:5432/postgres')).not.toBe(p);
    expect(p).not.toBe(sha('secret'));
    expect(ownerPassword('postgresql://postgres@localhost:5432/postgres')).toBe(sha(`${OWNER_ROLE}:`));
    expect(ownerPassword('postgresql://postgres:p%40ss@localhost/postgres')).toBe(sha(`${OWNER_ROLE}:p@ss`));
  });

  test('ownerUrl', () => {
    const admin = 'postgresql://postgres:secret@localhost:5432/postgres?application_name=x';
    const u = new URL(ownerUrl(admin, 'db1'));
    expect(u.username).toBe(OWNER_ROLE);
    expect(u.password).toBe(ownerPassword(admin));
    expect(u.pathname).toBe('/db1');
    expect(u.hostname).toBe('localhost');
    expect(u.port).toBe('5432');
    expect(u.searchParams.get('application_name')).toBe('x');
    expect(u.toString()).not.toContain('secret');
  });

  test('ownerRoleSql rejects a non-hex password', () => {
    expect(() => ownerRoleSql("x'; drop")).toThrow();
    const sql = ownerRoleSql(sha('x'));
    for (const k of ['LOGIN', 'NOSUPERUSER', 'NOCREATEDB', 'NOCREATEROLE', 'NOREPLICATION', 'NOBYPASSRLS']) expect(sql).toContain(k);
  });
});

describe('schema drift parser', () => {
  test('real schema.ts', () => {
    const text = readFileSync(SCHEMA_TS, 'utf8').replace(/\r\n/g, '\n');
    const ts = parseSchemaTs(text);
    const dbBlock = /export interface Database \{\n([\s\S]*?)^\}/m.exec(text)?.[1] ?? '';
    const keys = [...dbBlock.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
    expect(ts.size).toBe(18);
    expect([...ts.keys()]).toEqual(keys);
    expect(ts.get('transactions')!.get('fee')).toBe(true);
    expect(ts.get('transactions')!.get('seq')).toBe(false);
    expect(ts.get('settings')!.get('holidays')).toBe(false);
    expect(ts.get('signals')!.get('inputs_snapshot')).toBe(false);
  });

  test('fails closed', () => {
    const wrap = (body: string, db = '  t: TTable;') => `export interface TTable {\n${body}\n}\n\nexport interface Database {\n${db}\n}\n`;
    expect(parseSchemaTs(wrap('  a: string;'))).toEqual(new Map([['t', new Map([['a', false]])]]));
    expect(() => parseSchemaTs(wrap('  foo string'))).toThrow(/cannot parse/);
    expect(() => parseSchemaTs(wrap('  a: string;\n  a: number;'))).toThrow(/duplicate/);
    expect(() => parseSchemaTs(wrap('  a: string;', ''))).toThrow(/not in the Database map/);
    expect(() => parseSchemaTs(wrap('  a: string;', '  t: TTable;\n  u: UTable;'))).toThrow(/unknown interface/);
  });

  test('generic null is not nullable', () => {
    expect(isNullableType('ColumnType<string | null, string, string>')).toBe(false);
    expect(isNullableType('Json | null')).toBe(true);
    expect(isNullableType('string | undefined')).toBe(false);
  });
});

describe('compareSchema fixtures', () => {
  const ts = new Map([['t', new Map([['a', true], ['b', false]])]]);
  const row = (c: string, n: 'YES' | 'NO') => ({ table_name: 't', column_name: c, is_nullable: n });

  test('missing column', () => {
    expect(compareSchema(ts, [row('a', 'YES')])).toEqual([expect.stringContaining('t.b is in schema.ts but missing in database')]);
    expect(compareSchema(ts, [row('a', 'YES'), row('b', 'NO'), row('c', 'NO')])).toEqual([expect.stringContaining('t.c is in the database but missing in schema.ts')]);
    expect(compareSchema(ts, [])).toHaveLength(1);
    expect(compareSchema(new Map(), [row('a', 'NO')])).toEqual([expect.stringContaining('table t is in the database')]);
  });

  test('nullability flip', () => {
    const errs = compareSchema(ts, [row('a', 'NO'), row('b', 'NO')]);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('t.a');
    expect(errs[0]).toContain('schema.ts nullable=true');
    expect(errs[0]).toContain('database nullable=false');
    expect(compareSchema(ts, [row('a', 'YES'), row('b', 'NO')])).toEqual([]);
  });
});
