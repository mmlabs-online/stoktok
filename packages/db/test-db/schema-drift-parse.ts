/** Pure helpers for the schema.ts vs information_schema drift test (STK-089). No pg, no fs. */

export type TsSchema = Map<string, Map<string, boolean>>;
export interface DbColumnRow {
  table_name: string;
  column_name: string;
  is_nullable: string;
}

/** Removes `<...>` bodies (nesting-aware) so a `| null` inside a generic does not count. */
function stripGenerics(type: string): string {
  let depth = 0;
  let out = '';
  for (const ch of type) {
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    else if (depth === 0) out += ch;
  }
  return out;
}

export function isNullableType(type: string): boolean {
  return /\|\s*null\b/.test(stripGenerics(type));
}

/** table name (Database key) -> column -> nullable. Fails closed on anything it does not understand. */
export function parseSchemaTs(text: string): TsSchema {
  const src = text.replace(/\r\n/g, '\n');
  const interfaces = new Map<string, Map<string, boolean>>();
  for (const m of src.matchAll(/^export interface (\w+Table) \{\n([\s\S]*?)^\}/gm)) {
    const name = m[1] ?? '';
    const body = m[2] ?? '';
    const cols = new Map<string, boolean>();
    for (const line of body.split('\n')) {
      if (line.trim() === '' || /^\s*(\/\/|\/\*|\*)/.test(line)) continue;
      const c = /^\s*(\w+):\s*(.+);\s*$/.exec(line);
      if (!c) throw new Error(`schema.ts: cannot parse a line in ${name}: ${line.trim()}`);
      const col = c[1] ?? '';
      if (cols.has(col)) throw new Error(`schema.ts: duplicate column ${name}.${col}`);
      cols.set(col, isNullableType(c[2] ?? ''));
    }
    interfaces.set(name, cols);
  }
  const db = /^export interface Database \{\n([\s\S]*?)^\}/m.exec(src);
  if (!db) throw new Error('schema.ts: no Database interface');
  const out: TsSchema = new Map();
  const used = new Set<string>();
  for (const line of (db[1] ?? '').split('\n')) {
    if (line.trim() === '') continue;
    const e = /^\s*(\w+):\s*(\w+);\s*$/.exec(line);
    if (!e) throw new Error(`schema.ts: cannot parse a Database line: ${line.trim()}`);
    const key = e[1] ?? '';
    const iface = e[2] ?? '';
    const cols = interfaces.get(iface);
    if (!cols) throw new Error(`schema.ts: Database.${key} names unknown interface ${iface}`);
    out.set(key, cols);
    used.add(iface);
  }
  for (const name of interfaces.keys()) {
    if (!used.has(name)) throw new Error(`schema.ts: ${name} is not in the Database map`);
  }
  return out;
}

/** Messages for every difference, in both directions. Empty means no drift. */
export function compareSchema(ts: TsSchema, rows: readonly DbColumnRow[]): string[] {
  const db = new Map<string, Map<string, boolean>>();
  for (const r of rows) {
    const t = db.get(r.table_name) ?? new Map<string, boolean>();
    t.set(r.column_name, r.is_nullable === 'YES');
    db.set(r.table_name, t);
  }
  const errs: string[] = [];
  for (const [table, cols] of ts) {
    const dbCols = db.get(table);
    if (!dbCols) {
      errs.push(`table ${table} is in schema.ts but missing in database`);
      continue;
    }
    for (const [col, nullable] of cols) {
      const d = dbCols.get(col);
      if (d === undefined) errs.push(`column ${table}.${col} is in schema.ts but missing in database`);
      else if (d !== nullable) errs.push(`column ${table}.${col} nullability differs: schema.ts nullable=${nullable}, database nullable=${d}`);
    }
    for (const col of dbCols.keys()) {
      if (!cols.has(col)) errs.push(`column ${table}.${col} is in the database but missing in schema.ts`);
    }
  }
  for (const table of db.keys()) {
    if (!ts.has(table)) errs.push(`table ${table} is in the database but missing in schema.ts`);
  }
  return errs;
}
