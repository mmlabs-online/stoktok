import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const SKIP = new Set(['node_modules', '.next', 'dist', '.git']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const SDK_IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"](?:@anthropic-ai\/sdk|@google\/genai)/;

const DRIVER_IMPORT_PG = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"](?:pg|pg-[\w-]+)(?:\/[\w/-]+)?['"]/;

const NEXT_PUBLIC_RE = /NEXT_PUBLIC_\w*(SERVICE|KEY|DATABASE|DB_|PASSWORD|SECRET)/;
const DB_IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]@stoktok\/db(?:\/pg)?['"]/;

const CIPHER_CALL = /\bcreate(?:Dec|C)ipheriv\b/;
const KEYRING_OF = /\bkeyringOf\b/;
const KEYRING_IMPORT = /['"](?:\.\.?\/)+keyring['"]/;
const ENV_EXAMPLE_MASTER_KEY = /^STOKTOK_AI_KEYS_MASTER_KEY=\s*(#.*)?$/m;
const DROPPED_WRAPPERS = /\bai_key_(?:set|delete|secrets)\b/;

const files = [...walk(join(ROOT, 'apps')), ...walk(join(ROOT, 'packages'))]
  .filter((p) => !p.endsWith('r3-guard.test.ts') && !p.endsWith('next-env.d.ts'))
  .map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));

describe('R3 guard', () => {
  test('.env.example has no NEXT_PUBLIC_ key', () => {
    const env = readFileSync(join(ROOT, '.env.example'), 'utf8');
    expect(env.split('\n').filter((l) => /^\s*NEXT_PUBLIC_/.test(l))).toEqual([]);
  });

  test('no source file contains NEXT_PUBLIC_ next to SERVICE or KEY', () => {
    const bad = files.filter((f) => NEXT_PUBLIC_RE.test(f.text)).map((f) => f.path);
    expect(bad).toEqual([]);
  });

  test('SUPABASE_SERVICE_ROLE_KEY appears in no source file', () => {
    expect(files.filter((f) => f.text.includes('SUPABASE_SERVICE_ROLE_KEY')).map((f) => f.path)).toEqual([]);
  });

  test("no file containing 'use client' imports @stoktok/db, server/db, @stoktok/sources or @stoktok/ai", () => {
    const bad = files
      .filter((f) => /['"]use client['"]/.test(f.text) && /@stoktok\/db|server\/db|@stoktok\/sources|@stoktok\/ai|server\/ai/.test(f.text))
      .map((f) => f.path);
    expect(bad).toEqual([]);
  });

  test("apps/web/server/db.ts starts with import 'server-only'", () => {
    const text = readFileSync(join(ROOT, 'apps/web/server/db.ts'), 'utf8');
    expect(text.startsWith("import 'server-only';")).toBe(true);
    const importers = files.filter((f) => DB_IMPORT_RE.test(f.text)).map((f) => f.path);
    expect(importers.filter((p) => p.startsWith('apps/web/'))).toEqual(['apps/web/server/db.ts']);
  });

  test('guard regexes cover the database env names and the @stoktok/db/pg subpath', () => {
    for (const s of ['NEXT_PUBLIC_DATABASE_URL', 'NEXT_PUBLIC_DB_PASSWORD', 'NEXT_PUBLIC_STOKTOK_DATABASE_URL', 'NEXT_PUBLIC_SERVICE_KEY']) {
      expect(NEXT_PUBLIC_RE.test(s), s).toBe(true);
    }
    expect(NEXT_PUBLIC_RE.test('NEXT_PUBLIC_SUPABASE_URL')).toBe(false);
    expect(DB_IMPORT_RE.test(`from '@stoktok/db'`)).toBe(true);
    expect(DB_IMPORT_RE.test(`from '@stoktok/db/pg'`)).toBe(true);
    expect(DB_IMPORT_RE.test(`from "@stoktok/db"`)).toBe(true);
    expect(DB_IMPORT_RE.test(`await import('@stoktok/db/pg')`)).toBe(true);
    expect(DB_IMPORT_RE.test(`require("@stoktok/db")`)).toBe(true);
    expect(DB_IMPORT_RE.test(`from '@stoktok/dbx'`)).toBe(false);
  });

  test('AI key names appear only in packages/ai/src/env.ts and env.test.ts', () => {
    const hits = files
      .filter((f) => /ANTHROPIC_API_KEY|GOOGLE_AI_API_KEY/.test(f.text))
      .map((f) => f.path)
      .filter((p) => p !== 'packages/ai/src/env.ts' && p !== 'packages/ai/src/env.test.ts');
    expect(hits).toEqual([]);
  });

  test('AI SDKs (@anthropic-ai/sdk, @google/genai) are imported only under packages/ai/', () => {
    const hits = files.filter((f) => SDK_IMPORT.test(f.text)).map((f) => f.path).filter((p) => !p.startsWith('packages/ai/'));
    expect(hits).toEqual([]);
  });

  test('SDK regex catches from, import(), require() and side-effect import', () => {
    for (const s of [`from '@anthropic-ai/sdk'`, `from "@google/genai"`, `import('@google/genai')`, `require("@anthropic-ai/sdk")`, `import '@anthropic-ai/sdk'`]) {
      expect(SDK_IMPORT.test(s), s).toBe(true);
    }
    expect(SDK_IMPORT.test(`from '@stoktok/ai'`)).toBe(false);
  });

  test("apps/web/server/ai.ts exists, starts with import 'server-only' and imports from './db'", () => {
    const text = readFileSync(join(ROOT, 'apps/web/server/ai.ts'), 'utf8');
    expect(text.startsWith("import 'server-only';")).toBe(true);
    expect(text).toMatch(/from '\.\/db'/);
  });

  test('apps/web importers of @stoktok/ai are only apps/web/server/ai.ts', () => {
    const importer = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]@stoktok\/ai(?:\/[\w-]+)?['"]/;
    const importers = files.filter((f) => importer.test(f.text)).map((f) => f.path);
    expect(importers.filter((p) => p.startsWith('apps/web/')).filter((p) => p !== 'apps/web/server/ai.ts')).toEqual([]);
  });

  test('importer regex catches single and double quotes, import() and require()', () => {
    const importer = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]@stoktok\/ai(?:\/[\w-]+)?['"]/;
    for (const s of [`from '@stoktok/ai'`, `from "@stoktok/ai"`, `import('@stoktok/ai')`, `import("@stoktok/ai/fakes")`, `require('@stoktok/ai')`, `import '@stoktok/ai'`]) {
      expect(importer.test(s), s).toBe(true);
    }
    expect(importer.test(`from '@stoktok/db'`)).toBe(false);
  });

  test('@stoktok/ai/fakes is imported only from test files', () => {
    const fakes = /['"]@stoktok\/ai\/fakes['"]/;
    const hits = files.filter((f) => fakes.test(f.text)).map((f) => f.path).filter((p) => !/\.test\.tsx?$/.test(p));
    expect(hits).toEqual([]);
    expect(fakes.test(`import("@stoktok/ai/fakes")`)).toBe(true);
  });

  test('the decrypting entry point (readAiKeySecrets) appears only in the allowed files', () => {
    const allowed = new Set([
      'packages/db/src/repos/ai-keys.ts',
      'packages/db/src/repos/ai-keys.test.ts',
      'packages/db/test-db/ai-keys.test.ts',
      'packages/db/src/index.ts',
      'apps/web/server/ai.ts',
      'apps/web/server/ai.test.ts',
      'apps/worker/src/ai.ts',
      'apps/worker/src/ai.test.ts',
    ]);
    const hits = files.filter((f) => /\breadAiKeySecrets\b/.test(f.text)).map((f) => f.path).filter((p) => !allowed.has(p));
    expect(hits).toEqual([]);
  });

  test('the dropped Vault wrappers (ai_key_set, ai_key_delete, ai_key_secrets) appear in no TS/JS file', () => {
    expect(files.filter((f) => DROPPED_WRAPPERS.test(f.text)).map((f) => f.path)).toEqual([]);
    expect(DROPPED_WRAPPERS.test('select public.ai_key_set(')).toBe(true);
    expect(DROPPED_WRAPPERS.test('public.ai_key_secrets()')).toBe(true);
    expect(DROPPED_WRAPPERS.test("log('ai_key_delete_failed', provider, e)")).toBe(false);
  });

  test("apps/web/server/ai-keys.ts starts with import 'server-only'", () => {
    expect(readFileSync(join(ROOT, 'apps/web/server/ai-keys.ts'), 'utf8').startsWith("import 'server-only';")).toBe(true);
  });

  test('the settings key actions, page and card never reference the decrypting entry points', () => {
    const targets = files.filter(
      (f) =>
        f.path === 'apps/web/server/ai-keys.ts' ||
        f.path === 'apps/web/app/(app)/settings/actions.ts' ||
        f.path === 'apps/web/app/(app)/settings/page.tsx' ||
        f.path.startsWith('apps/web/components/settings/'),
    );
    expect(targets.length).toBeGreaterThanOrEqual(5);
    expect(targets.filter((f) => /readAiKeySecrets/.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  test("the AI keys card is a client component and imports nothing from a server path", () => {
    const card = files.find((f) => f.path === 'apps/web/components/settings/ai-keys-card.tsx')!;
    expect(card.text).toContain("'use client'");
    expect(card.text).not.toMatch(/from\s+['"][^'"]*server\//);
  });

  test('no TS/JS file references Vault objects', () => {
    const vault = /vault\.(secrets|decrypted_secrets|create_secret|update_secret)/;
    expect(files.filter((f) => vault.test(f.text)).map((f) => f.path)).toEqual([]);
    expect(vault.test('vault.decrypted_secrets')).toBe(true);
  });

  test('STOKTOK_DATABASE_URL is referenced only in packages/db/src/pg/client.ts (and its test)', () => {
    const hits = files
      .filter((f) => f.text.includes('STOKTOK_DATABASE_URL'))
      .map((f) => f.path)
      .filter((p) => p !== 'packages/db/src/pg/client.ts' && p !== 'packages/db/src/pg/client.test.ts');
    expect(hits).toEqual([]);
  });

  test('databaseUrlFromEnv is used only in pg/client.ts, pg/migrate.ts and their tests; not in the barrel', () => {
    const allowed = new Set(['client', 'migrate'].flatMap((n) => [`packages/db/src/pg/${n}.ts`, `packages/db/src/pg/${n}.test.ts`]));
    const hits = files.filter((f) => f.text.includes('databaseUrlFromEnv')).map((f) => f.path).filter((p) => !allowed.has(p));
    expect(hits).toEqual([]);
    expect(files.find((f) => f.path === 'packages/db/src/pg/index.ts')!.text).not.toContain('databaseUrlFromEnv');
  });

  test('STOKTOK_AI_KEYS_MASTER_KEY is referenced only in packages/db/src/pg/client.ts and client.test.ts', () => {
    const hits = files
      .filter((f) => f.text.includes('STOKTOK_AI_KEYS_MASTER_KEY'))
      .map((f) => f.path)
      .filter((p) => p !== 'packages/db/src/pg/client.ts' && p !== 'packages/db/src/pg/client.test.ts');
    expect(hits).toEqual([]);
  });

  test('createCipheriv / createDecipheriv are called only in packages/db/src/keyring.ts and keyring.test.ts', () => {
    const hits = files
      .filter((f) => CIPHER_CALL.test(f.text))
      .map((f) => f.path)
      .filter((p) => p !== 'packages/db/src/keyring.ts' && p !== 'packages/db/src/keyring.test.ts');
    expect(hits).toEqual([]);
    expect(CIPHER_CALL.test("createCipheriv('aes-256-gcm', k, iv)")).toBe(true);
    expect(CIPHER_CALL.test('crypto.createDecipheriv(a, k, iv)')).toBe(true);
    expect(CIPHER_CALL.test('createCipherivX')).toBe(false);
  });

  test('keyringOf appears only in pg/access.ts, repos/ai-keys.ts and test-db/', () => {
    const hits = files
      .filter((f) => KEYRING_OF.test(f.text))
      .map((f) => f.path)
      .filter((p) => p !== 'packages/db/src/pg/access.ts' && p !== 'packages/db/src/repos/ai-keys.ts' && !p.startsWith('packages/db/test-db/'));
    expect(hits).toEqual([]);
    expect(KEYRING_OF.test('keyringOf(db)')).toBe(true);
    expect(KEYRING_OF.test('mykeyringOfX')).toBe(false);
  });

  test('a keyring module is imported only by pg/client.ts, pg/access.ts, repos/ai-keys.ts, keyring.test.ts and test-db/; no barrel mentions it', () => {
    const allowed = new Set(['packages/db/src/pg/client.ts', 'packages/db/src/pg/access.ts', 'packages/db/src/repos/ai-keys.ts', 'packages/db/src/keyring.test.ts']);
    const hits = files
      .filter((f) => KEYRING_IMPORT.test(f.text))
      .map((f) => f.path)
      .filter((p) => !allowed.has(p) && !p.startsWith('packages/db/test-db/'));
    expect(hits).toEqual([]);
    for (const barrel of ['packages/db/src/index.ts', 'packages/db/src/pg/index.ts']) {
      expect(files.find((f) => f.path === barrel)!.text).not.toMatch(/keyring/i);
    }
    expect(KEYRING_IMPORT.test(`from '../keyring'`)).toBe(true);
    expect(KEYRING_IMPORT.test(`from './keyring'`)).toBe(true);
    expect(KEYRING_IMPORT.test(`from '../../keyring'`)).toBe(true);
    expect(KEYRING_IMPORT.test(`from '../keyrings'`)).toBe(false);
  });

  test('.env.example lists STOKTOK_AI_KEYS_MASTER_KEY with no value', () => {
    const env = readFileSync(join(ROOT, '.env.example'), 'utf8');
    expect(env).toMatch(ENV_EXAMPLE_MASTER_KEY);
    expect(ENV_EXAMPLE_MASTER_KEY.test('STOKTOK_AI_KEYS_MASTER_KEY=          # 32 bytes')).toBe(true);
    expect(ENV_EXAMPLE_MASTER_KEY.test('STOKTOK_AI_KEYS_MASTER_KEY=abc')).toBe(false);
  });
});

// STK-081 b1: Kysely is reachable only through q() in packages/db/src/pg/access.ts, which wraps run().
const PG_DIRS = ['packages/db/src/pg/', 'packages/db/test-db/'];
const inPgDirs = (p: string) => PG_DIRS.some((d) => p.startsWith(d));

const KYSELY_REEXPORT = /export\s+(?:type\s+)?(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+['"]kysely['"]/g;
const KYSELY_DYNAMIC = /(?:import\s*\(\s*|require\s*\(\s*|import\s+)['"]kysely['"]/;
const KYSELY_FROM = /import\s+(type\s+)?([^;]*?)\s+from\s+['"]kysely['"]/g;
const KYSELY_CTOR_LOG = /new\s+Kysely\b[^(]*\([\s\S]*?(?<![.\w])['"]?log['"]?\s*[:(,}]/;
const SUPABASE_IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]@supabase\//;
const CREATE_PG_DB = /\bcreatePgDb\s*\(/;
const ACCESSOR = /kyselyOf|stoktok\.pgdb\.internals|getOwnPropertySymbols|Reflect\s*\.\s*ownKeys/;

/** True when the text imports kysely in a form other than `sql` or types only. */
function kyselyViolation(text: string): boolean {
  if (KYSELY_DYNAMIC.test(text)) return true;
  for (const m of text.matchAll(KYSELY_REEXPORT)) {
    if (/^export\s+type\b/.test(m[0])) continue;
    if (/^export\s*\{/.test(m[0])) {
      const names = m[0].replace(/^export\s*\{|\}[\s\S]*$/g, '').split(',').map((x) => x.trim()).filter(Boolean);
      if (names.every((n) => n === 'sql' || n.startsWith('type '))) continue;
    }
    return true;
  }
  for (const m of text.matchAll(KYSELY_FROM)) {
    if (m[1]) continue;
    const spec = m[2]!.trim();
    if (!spec.startsWith('{')) return true;
    const names = spec.replace(/^\{|\}$/g, '').split(',').map((x) => x.trim()).filter(Boolean);
    if (names.some((n) => n !== 'sql' && !n.startsWith('type '))) return true;
  }
  return false;
}

describe('S5 data access', () => {
  test('S5: pg/pg-* imported only under packages/db/src/pg/ and test-db/; kysely outside them only as sql or type', () => {
    const drivers = files.filter((f) => DRIVER_IMPORT_PG.test(f.text)).map((f) => f.path).filter((p) => !inPgDirs(p));
    expect(drivers).toEqual([]);
    const kysely = files.filter((f) => kyselyViolation(f.text)).map((f) => f.path).filter((p) => !inPgDirs(p));
    expect(kysely).toEqual([]);
  });

  test('S5: kyselyOf and the internals symbol appear only under packages/db/src/pg/ and packages/db/test-db/', () => {
    const hits = files.filter((f) => ACCESSOR.test(f.text)).map((f) => f.path).filter((p) => !inPgDirs(p));
    expect(hits).toEqual([]);
  });

  test('S5: new Kysely( appears only in packages/db/src/pg/client.ts and packages/db/src/pg/*.test.ts, never with a log option', () => {
    const ctor = files.filter((f) => /new\s+Kysely\b/.test(f.text)).map((f) => f.path);
    expect(ctor.filter((p) => p !== 'packages/db/src/pg/client.ts' && !/^packages\/db\/src\/pg\/[\w-]+\.test\.ts$/.test(p))).toEqual([]);
    expect(files.filter((f) => KYSELY_CTOR_LOG.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  test('S5: createPgDb( is called only under pg/, test-db/, apps/web/server/db.ts and apps/worker/src/cli.ts', () => {
    const allowed = new Set(['apps/web/server/db.ts', 'apps/worker/src/cli.ts']);
    const hits = files.filter((f) => CREATE_PG_DB.test(f.text)).map((f) => f.path).filter((p) => !inPgDirs(p) && !allowed.has(p));
    expect(hits).toEqual([]);
  });

  test('S5: @supabase/ imports (from, import type, import(), require(), side-effect, export-from) only under apps/web/server/auth/', () => {
    const hits = files.filter((f) => SUPABASE_IMPORT.test(f.text)).map((f) => f.path).filter((p) => !p.startsWith('apps/web/server/auth/'));
    expect(hits).toEqual([]);
  });

  test('S5: packages/db and apps/worker package.json declare no @supabase/* in any dependency field', () => {
    for (const pkg of ['packages/db/package.json', 'apps/worker/package.json']) {
      const json = JSON.parse(readFileSync(join(ROOT, pkg), 'utf8')) as Record<string, Record<string, string> | undefined>;
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        expect(Object.keys(json[field] ?? {}).filter((n) => n.startsWith('@supabase/')), `${pkg} ${field}`).toEqual([]);
      }
    }
  });

  test('S5: pg and kysely ranges in apps/worker and pg in apps/web equal packages/db', () => {
    const deps = (pkg: string) => (JSON.parse(readFileSync(join(ROOT, pkg), 'utf8')) as { dependencies: Record<string, string> }).dependencies;
    const db = deps('packages/db/package.json');
    expect(db.pg).toBeTruthy();
    expect(db.kysely).toBeTruthy();
    expect(deps('apps/worker/package.json').pg).toBe(db.pg);
    expect(deps('apps/worker/package.json').kysely).toBe(db.kysely);
    expect(deps('apps/web/package.json').pg).toBe(db.pg);
  });

  test('S5 regexes catch their fixtures', () => {
    for (const s of [`import { Kysely } from 'kysely'`, `import * as k from 'kysely'`, `const k = await import('kysely')`, `import { sql, Kysely } from 'kysely'`]) {
      expect(kyselyViolation(s), s).toBe(true);
    }
    for (const s of [`import { sql } from 'kysely'`, `import type { Kysely } from 'kysely'`, `import { sql, type RawBuilder } from 'kysely'`]) {
      expect(kyselyViolation(s), s).toBe(false);
    }
    expect(KYSELY_CTOR_LOG.test('new Kysely<Database>({ log: (e) => e, dialect })')).toBe(true);
    expect(KYSELY_CTOR_LOG.test('new Kysely<Database>({ dialect: new PostgresDialect({ pool }), log: (e) => e })')).toBe(true);
    expect(KYSELY_CTOR_LOG.test('new Kysely<Database>({\n  dialect: new PostgresDialect({ pool }),\n  log(e) {},\n})')).toBe(true);
    expect(KYSELY_CTOR_LOG.test('new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })')).toBe(false);
    expect(KYSELY_CTOR_LOG.test('new Kysely({ dialect: new PostgresDialect({ pool }), log })')).toBe(true);
    expect(KYSELY_CTOR_LOG.test('new Kysely({ log, dialect })')).toBe(true);
    expect(KYSELY_CTOR_LOG.test(`new Kysely({ dialect, 'log': f })`)).toBe(true);
    expect(KYSELY_CTOR_LOG.test('new Kysely({ dialect }); console.log(1)')).toBe(false);
    for (const s of [`export { Kysely } from 'kysely'`, `export * from 'kysely'`, `export * as k from 'kysely'`, `export { sql, Kysely } from 'kysely'`]) {
      expect(kyselyViolation(s), s).toBe(true);
    }
    for (const s of [`export { sql } from 'kysely'`, `export type { Kysely } from 'kysely'`, `export { type Kysely, sql } from 'kysely'`]) {
      expect(kyselyViolation(s), s).toBe(false);
    }
    expect(ACCESSOR.test('Object.getOwnPropertySymbols(db)')).toBe(true);
    expect(ACCESSOR.test('Reflect.ownKeys(db)')).toBe(true);
    expect(CREATE_PG_DB.test('createPgDb(process.env, "web")')).toBe(true);
    for (const x of [`from '@supabase/ssr'`, `import type { A } from "@supabase/supabase-js"`, `await import('@supabase/ssr')`, `require("@supabase/supabase-js")`, `import '@supabase/ssr'`, `export * from '@supabase/ssr'`]) {
      expect(SUPABASE_IMPORT.test(x), x).toBe(true);
    }
    expect(SUPABASE_IMPORT.test(`from '@stoktok/db'`)).toBe(false);
    expect(ACCESSOR.test('kyselyOf(db)')).toBe(true);
    expect(ACCESSOR.test(`Symbol.for('stoktok.pgdb.internals')`)).toBe(true);
    expect(DRIVER_IMPORT_PG.test(`from 'pg'`)).toBe(true);
    expect(DRIVER_IMPORT_PG.test(`import('pg-protocol')`)).toBe(true);
    expect(DRIVER_IMPORT_PG.test(`from '@stoktok/db/pg'`)).toBe(false);
  });
});
