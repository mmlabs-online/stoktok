import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const UP_DIR = join(ROOT, 'db', 'migrations');
const DOWN_DIR = join(ROOT, 'db', 'rollback');
const BASELINE = '20261111000200_baseline.sql';

const UP_RE = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const DOWN_RE = /^(\d{14})_([a-z0-9_]+)\.down\.sql$/;

// One pass so that `--` inside a string and quotes inside a comment are both handled.
const TOKEN_RE = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g;

/** Removes `--` and block comments. Strings and dollar-quoted bodies stay. */
export function stripComments(sql: string): string {
  return sql.replace(TOKEN_RE, (m) => (m.startsWith('--') || m.startsWith('/*') ? ' ' : m));
}

/** Removes comments, single-quoted strings and dollar-quoted bodies. */
export function stripLiterals(sql: string): string {
  return sql.replace(TOKEN_RE, ' ');
}

const FORBIDDEN: [string, RegExp][] = [
  'grant',
  'create\\s+role',
  'alter\\s+role',
  'create\\s+user',
  'create\\s+extension',
  'row\\s+level\\s+security',
  'create\\s+policy',
  'alter\\s+default\\s+privileges',
  'security\\s+definer',
  'set\\s+role',
  'set\\s+session\\s+authorization',
  'vault',
  'concurrently',
  'anon',
  'authenticated',
  'service_role',
].map((w) => [w, new RegExp(`\\b${w}\\b`, 'i')]);

const TX_RE = /^(begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction)\b/i;

/** Names of the forbidden constructs found in a migration file. */
export function lintMigration(sql: string): string[] {
  const found: string[] = [];
  const noComments = stripComments(sql);
  for (const [name, re] of FORBIDDEN) if (re.test(noComments)) found.push(name.replace(/\\s\+/g, ' '));
  for (const stmt of stripLiterals(sql).split(';')) {
    const m = TX_RE.exec(stmt.trim());
    if (m) found.push(`transaction control: ${m[1]!.toLowerCase()}`);
  }
  return found;
}

const upFiles = readdirSync(UP_DIR).filter((n) => n !== 'README.md');
const downFiles = readdirSync(DOWN_DIR);

describe('migrations lint', () => {
  test('file names and parity', () => {
    expect(upFiles.length).toBeGreaterThan(0);
    for (const f of upFiles) expect(f, f).toMatch(UP_RE);
    for (const f of downFiles) expect(f, f).toMatch(DOWN_RE);
    const key = (f: string, re: RegExp) => f.replace(re, '$1_$2');
    expect(downFiles.map((f) => key(f, DOWN_RE)).sort()).toEqual(upFiles.map((f) => key(f, UP_RE)).sort());
  });

  test('forbidden statements', () => {
    for (const f of upFiles) expect(lintMigration(readFileSync(join(UP_DIR, f), 'utf8')), f).toEqual([]);
  });

  test('baseline is plain create', () => {
    const sql = stripComments(readFileSync(join(UP_DIR, BASELINE), 'utf8'));
    expect(sql).not.toMatch(/\bif\s+not\s+exists\b/i);
    expect(sql).not.toMatch(/\bor\s+replace\b/i);
    expect(sql).not.toMatch(/\bdrop\b/i);
    expect(sql).not.toMatch(/\bdo\s+\$/i);
    expect(sql.match(/\brevoke\b/gi)).toHaveLength(2);
    expect(sql.match(/\brevoke\s+execute\s+on\s+function\s[^;]*\sfrom\s+public\s*;/gi)).toHaveLength(2);
  });

  test('lint helpers catch their fixtures', () => {
    expect(lintMigration('grant select on t to x;')).toEqual(['grant']);
    expect(lintMigration('create index concurrently i on t (c);')).toEqual(['concurrently']);
    expect(lintMigration('select 1;\ncommit;')).toEqual(['transaction control: commit']);
    expect(lintMigration('begin;\nselect 1;')).toEqual(['transaction control: begin']);
    expect(lintMigration('alter table t enable row level security;')).toEqual(['row level security']);
    expect(lintMigration('create table t (granted boolean);\nselect v_granted := 1;')).toEqual([]);
    expect(lintMigration('create function f() returns int as $$ begin return 1; end $$ language plpgsql;')).toEqual([]);
    expect(lintMigration('-- grant all\nselect 1;')).toEqual([]);
    expect(lintMigration("select 'commit;';")).toEqual([]);
  });
});
