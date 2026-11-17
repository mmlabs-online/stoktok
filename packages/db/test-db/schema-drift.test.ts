import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { freshDb, type TestDb } from './harness';

const SCHEMA_TS = join(__dirname, '..', 'src', 'pg', 'schema.ts');

const TABLES = [
  'ai_keys', 'ai_summaries', 'ai_usage', 'assets', 'corporate_actions', 'data_gaps', 'financial_lines', 'financials',
  'lottery_draws', 'lottery_tickets', 'news', 'prices_daily', 'prices_intraday', 'settings', 'signals', 'symbols',
  'transactions', 'watchlist',
];

type Cols = Map<string, boolean>; // column -> nullable
type DbRow = { table_name: string; column_name: string; is_nullable: 'YES' | 'NO' };

function bodyLines(body: string, owner: string): string[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !/^(\/\/|\/\*|\*)/.test(l))
    .map((l) => {
      if (!/^\w+:\s*.+;$/.test(l)) throw new Error(`unparsed line in ${owner}: ${l}`);
      return l;
    });
}

/** table name -> column -> nullable. Fails closed on anything it cannot parse. */
export function parseSchemaTs(text: string): Map<string, Cols> {
  const ifaces = new Map<string, Cols>();
  for (const m of text.matchAll(/export interface (\w+Table) \{([\s\S]*?)\n\}/g)) {
    const cols: Cols = new Map();
    for (const l of bodyLines(m[2]!, m[1]!)) {
      const [, name, type] = /^(\w+):\s*(.+);$/.exec(l)!;
      cols.set(name!, /\|\s*null\b/.test(type!));
    }
    ifaces.set(m[1]!, cols);
  }
  const db = /export interface Database \{([\s\S]*?)\n\}/.exec(text);
  if (!db) throw new Error('no Database interface');
  const tables = new Map<string, Cols>();
  const used = new Set<string>();
  for (const l of bodyLines(db[1]!, 'Database')) {
    const m = /^(\w+):\s*(\w+Table);$/.exec(l);
    if (!m) throw new Error(`unparsed line in Database: ${l}`);
    const cols = ifaces.get(m[2]!);
    if (!cols) throw new Error(`Database names unknown interface ${m[2]}`);
    tables.set(m[1]!, cols);
    used.add(m[2]!);
  }
  for (const name of ifaces.keys()) if (!used.has(name)) throw new Error(`${name} is not in the Database map`);
  return tables;
}

export function diffSchema(ts: Map<string, Cols>, rows: DbRow[]): string[] {
  const dbTables = new Map<string, Cols>();
  for (const r of rows) {
    if (!dbTables.has(r.table_name)) dbTables.set(r.table_name, new Map());
    dbTables.get(r.table_name)!.set(r.column_name, r.is_nullable === 'YES');
  }
  const out: string[] = [];
  for (const t of new Set([...ts.keys(), ...dbTables.keys()])) {
    const a = ts.get(t);
    const b = dbTables.get(t);
    if (!a) { out.push(`${t}: table in db, missing in schema.ts`); continue; }
    if (!b) { out.push(`${t}: table in schema.ts, missing in db`); continue; }
    for (const [c, nullable] of a) {
      if (!b.has(c)) out.push(`${t}.${c}: in schema.ts, missing in db`);
      else if (b.get(c) !== nullable) out.push(`${t}.${c}: nullability schema.ts=${nullable ? 'nullable' : 'not null'} db=${b.get(c) ? 'nullable' : 'not null'}`);
    }
    for (const c of b.keys()) if (!a.has(c)) out.push(`${t}.${c}: in db, missing in schema.ts`);
  }
  return out.sort();
}

const FIXTURE = `
export interface ATable {
  x: string;
  y: number | null;
}
export interface Database {
  a: ATable;
}
`;

describe('schema.ts parser', () => {
  test('reads every table of schema.ts', () => {
    const ts = parseSchemaTs(readFileSync(SCHEMA_TS, 'utf8'));
    expect([...ts.keys()].sort()).toEqual(TABLES);
    expect(ts.get('transactions')!.get('fee')).toBe(true);
    expect(ts.get('transactions')!.get('id')).toBe(false);
    expect(ts.get('settings')!.get('holidays')).toBe(false);
  });

  test('fails closed', () => {
    expect(() => parseSchemaTs(FIXTURE.replace('  x: string;', '  weird line'))).toThrow(/unparsed line in ATable/);
    expect(() => parseSchemaTs(FIXTURE.replace('a: ATable', 'a: BTable'))).toThrow(/unknown interface/);
    expect(() => parseSchemaTs(`${FIXTURE.replace('  a: ATable;\n', '')}`)).toThrow(/not in the Database map/);
    expect(() => parseSchemaTs('export interface ATable {\n  x: string;\n}\n')).toThrow(/no Database/);
  });

  test('diff flags a missing column and a nullability flip (fixture)', () => {
    const ts = parseSchemaTs(FIXTURE);
    const rows: DbRow[] = [
      { table_name: 'a', column_name: 'x', is_nullable: 'NO' },
      { table_name: 'a', column_name: 'y', is_nullable: 'NO' },
      { table_name: 'a', column_name: 'z', is_nullable: 'YES' },
    ];
    expect(diffSchema(ts, rows)).toEqual(['a.y: nullability schema.ts=nullable db=not null', 'a.z: in db, missing in schema.ts']);
    expect(diffSchema(ts, rows.slice(1))).toContain('a.x: in schema.ts, missing in db');
    expect(diffSchema(ts, [...rows, { table_name: 'b', column_name: 'q', is_nullable: 'NO' }])).toContain('b: table in db, missing in schema.ts');
    expect(diffSchema(ts, [])).toEqual(['a: table in schema.ts, missing in db']);
  });
});

describe('schema drift', () => {
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

  test('schema.ts matches the migrated database', async () => {
    const { rows } = await c.query<DbRow>("select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name <> 'schema_migrations'");
    expect(new Set(rows.map((r) => r.table_name)).size).toBe(18);
    expect(diffSchema(parseSchemaTs(readFileSync(SCHEMA_TS, 'utf8')), rows)).toEqual([]);
  });
});
