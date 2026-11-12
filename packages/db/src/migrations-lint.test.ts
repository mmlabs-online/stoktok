import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const UP_DIR = join(ROOT, 'db', 'migrations');
const DOWN_DIR = join(ROOT, 'db', 'rollback');
const BASELINE = '20261111000200_baseline.sql';

/** Matches the start of a DO block; shared by the baseline check and its fixtures. */
export const BASELINE_DO_RE = /\bdo\s+(language\s+\w+\s+)?(\$|')/i;

const UP_RE =/^(\d{14})_([a-z0-9_]+)\.sql$/;
const DOWN_RE = /^(\d{14})_([a-z0-9_]+)\.down\.sql$/;

// One pass so that `--` inside a string and quotes inside a comment are both handled.
// Order matters: E-strings before plain strings; quoted identifiers and digit-bearing dollar tags as Postgres reads them.
// This lint catches accidents, not a hostile file; the real defence is the owner-only role plus the db:check ACL checks.
const NOT_IDENT = String.raw`(?<![A-Za-z0-9_$\u{80}-\u{10FFFF}])`;
const TAG = String.raw`[A-Za-z_\u{80}-\u{10FFFF}][A-Za-z0-9_\u{80}-\u{10FFFF}]*`;
const TOKEN_RE = new RegExp(
  String.raw`--[^\n]*|\/\*[\s\S]*?\*\/|${NOT_IDENT}[Ee]'(?:[^'\\]|\\[\s\S]|'')*'|'(?:[^']|'')*'|"(?:[^"]|"")*"|${NOT_IDENT}\$(${TAG})?\$[\s\S]*?\$\1\$`,
  'gu',
);

/** Removes `--` and block comments. Strings and dollar-quoted bodies stay. */
export function stripComments(sql: string): string {
  return sql.replace(TOKEN_RE, (m) => (m.startsWith('--') || m.startsWith('/*') ? ' ' : m));
}

/** Removes comments, single-quoted strings and dollar-quoted bodies. */
export function stripLiterals(sql: string): string {
  return sql.replace(TOKEN_RE, ' ');
}

const FORBIDDEN: [string, RegExp][] = [
  ['grant', /\bgrant\b/i],
  ['create role', /\bcreate\s+role\b/i],
  ['alter role', /\balter\s+role\b/i],
  ['create user', /\bcreate\s+user\b/i],
  ['create extension', /\bcreate\s+extension\b/i],
  ['create schema', /\bcreate\s+schema\b/i],
  ['owner to', /\bowner\s+to\b/i],
  ['row level security', /\brow\s+level\s+security\b/i],
  ['create policy', /\bcreate\s+policy\b/i],
  ['alter default privileges', /\balter\s+default\s+privileges\b/i],
  ['security definer', /\bsecurity\s+definer\b/i],
  ['set role', /\b(set|reset)\s+(local\s+|session\s+)?role\b/i],
  ['set_config role', /\bset_config\s*\(\s*[Ee]?'(role|session_authorization)'/i],
  ['set session authorization', /\b(set|reset)\s+(local\s+|session\s+)?session\s+authorization\b/i],
  ['migrating guard', /\bstoktok\.migrating\b/i],
  ['vault', /\bvault\b/i],
  ['concurrently', /\bconcurrently\b/i],
  ['anon', /\banon\b/i],
  ['authenticated', /\bauthenticated\b/i],
  ['service_role', /\bservice_role\b/i],
];

const TX_RE = /^(begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction)\b/i;

/** Names of the forbidden constructs found in a migration file. */
export function lintMigration(sql: string): string[] {
  const found: string[] = [];
  if ([...sql.matchAll(TOKEN_RE)].some((m) => m[0].startsWith('/*')) || stripLiterals(sql).includes('/*')) found.push('block comment');
  const noComments = stripComments(sql);
  for (const [name, re] of FORBIDDEN) if (re.test(noComments)) found.push(name);
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
    expect(sql).not.toMatch(BASELINE_DO_RE);
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

  test('tokeniser bypass fixtures', () => {
    expect(lintMigration("select E'\\' -- '; grant select on t to x; -- ';")).toEqual(['grant']);
    expect(lintMigration('create table "a--b" (c int); grant select on "a--b" to y;')).toEqual(['grant']);
    expect(lintMigration('select $f1$ -- $f1$; grant select on t to x;')).toEqual(['grant']);
    expect(lintMigration("select $f1$ ' $f1$; commit;")).toEqual(['transaction control: commit']);
    expect(lintMigration("select e'it''s'; commit;")).toEqual(['transaction control: commit']);
    expect(lintMigration('select 1 as "x;commit";')).toEqual([]);
    expect(lintMigration('select 1 as x$a$; grant select on t to public; -- $a$')).toEqual(['grant']);
    expect(lintMigration('select $é$ -- $é$; grant select on t to public;')).toEqual(['grant']);
    expect(lintMigration("select éE'\\'; grant select on t to x; -- '")).toEqual(['grant']);
    expect(lintMigration("select x$E'\\'; grant select on t to x; -- '")).toEqual(['grant']);
    expect(lintMigration('select $é$ commit; $é$;')).toEqual([]);
  });

  test('block comment fixtures', () => {
    expect(lintMigration("/* /* */ ' */ commit; -- '")).toEqual(['block comment']);
    expect(lintMigration('/* x */ select 1;')).toEqual(['block comment']);
    expect(lintMigration('/* unterminated')).toEqual(['block comment']);
    expect(lintMigration("select '/*';")).toEqual([]);
    expect(lintMigration('-- /*')).toEqual([]);
    expect(lintMigration('select 1 as "a/*b";')).toEqual([]);
  });

  test('migrating guard fixtures', () => {
    expect(lintMigration("set local stoktok.migrating = 'x';")).toEqual(['migrating guard']);
    expect(lintMigration("select set_config('stoktok.migrating', 'x', true);")).toEqual(['migrating guard']);
    expect(lintMigration('-- stoktok.migrating')).toEqual([]);
  });

  test('role, schema and owner fixtures', () => {
    for (const sql of ['set local role x;', 'SET SESSION ROLE x;', 'reset role;']) expect(lintMigration(sql), sql).toEqual(['set role']);
    expect(lintMigration("select set_config('role', 'x', false);")).toEqual(['set_config role']);
    expect(lintMigration("select set_config(E'role', 'x', false);")).toEqual(['set_config role']);
    expect(lintMigration("select set_config(e'role', 'x', false);")).toEqual(['set_config role']);
    expect(lintMigration("select set_config('session_authorization', 'x', false);")).toEqual(['set_config role']);
    expect(lintMigration('set local session authorization x;')).toEqual(['set session authorization']);
    expect(lintMigration('reset session authorization;')).toEqual(['set session authorization']);
    expect(lintMigration('create schema other;')).toEqual(['create schema']);
    expect(lintMigration('alter table t owner to x;')).toEqual(['owner to']);
    expect(lintMigration('create table t (role text, owner_id int);')).toEqual([]);
  });

  test('baseline do-block fixtures', () => {
    for (const sql of ['do $$ begin end $$;', 'do language plpgsql $$ begin end $$;', "do 'begin end';"]) expect(sql).toMatch(BASELINE_DO_RE);
    expect('select 1;').not.toMatch(BASELINE_DO_RE);
  });
});
