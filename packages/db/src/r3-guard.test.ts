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

const DRIVER_IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"](?:pg|pg-[\w-]+|kysely)(?:\/[\w/-]+)?['"]/;

const NEXT_PUBLIC_RE = /NEXT_PUBLIC_\w*(SERVICE|KEY|DATABASE|DB_|PASSWORD|SECRET)/;
const DB_IMPORT_RE = /from '@stoktok\/db(?:\/pg)?'/;

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

  test('SUPABASE_SERVICE_ROLE_KEY is referenced only in packages/db/src/client.ts (and its tests)', () => {
    const hits = files
      .filter((f) => f.text.includes('SUPABASE_SERVICE_ROLE_KEY'))
      .map((f) => f.path)
      .filter((p) => p !== 'packages/db/src/client.ts' && p !== 'packages/db/src/client.test.ts');
    expect(hits).toEqual([]);
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

  test('the Vault entry points (ai_key_secrets, readAiKeySecrets) appear only in the allowed files', () => {
    const allowed = new Set([
      'packages/db/src/repos/ai-keys.ts',
      'packages/db/src/repos/ai-keys.test.ts',
      'packages/db/src/index.ts',
      'apps/web/server/ai.ts',
      'apps/web/server/ai.test.ts',
      'apps/worker/src/ai.ts',
      'apps/worker/src/ai.test.ts',
    ]);
    const hits = files.filter((f) => /ai_key_secrets|readAiKeySecrets/.test(f.text)).map((f) => f.path).filter((p) => !allowed.has(p));
    expect(hits).toEqual([]);
  });

  test('the write wrappers (ai_key_set, ai_key_delete) appear only in the ai-keys repo, the web ai-keys module and their tests', () => {
    const allowed = new Set([
      'packages/db/src/repos/ai-keys.ts',
      'packages/db/src/repos/ai-keys.test.ts',
      'apps/web/server/ai-keys.ts',
      'apps/web/server/ai-keys.test.ts',
    ]);
    const hits = files.filter((f) => /ai_key_set|ai_key_delete/.test(f.text)).map((f) => f.path).filter((p) => !allowed.has(p));
    expect(hits).toEqual([]);
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
    expect(targets.filter((f) => /readAiKeySecrets|ai_key_secrets/.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  test("the AI keys card is a client component and imports nothing from a server path", () => {
    const card = files.find((f) => f.path === 'apps/web/components/settings/ai-keys-card.tsx')!;
    expect(card.text).toContain("'use client'");
    expect(card.text).not.toMatch(/from\s+['"][^'"]*server\//);
  });

  test('no TS/JS file references Vault objects (Vault is reached only through the SQL wrappers)', () => {
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

  test('pg and kysely are imported only under packages/db/', () => {
    const hits = files.filter((f) => DRIVER_IMPORT.test(f.text)).map((f) => f.path).filter((p) => !p.startsWith('packages/db/'));
    expect(hits).toEqual([]);
  });

  test('driver regex catches pg, kysely, pg-* in every import form and not @stoktok/db/pg', () => {
    for (const s of [`from 'pg'`, `from "kysely"`, `import('pg')`, `require('pg-protocol')`, `import 'pg'`, `from 'pg/lib/x'`]) {
      expect(DRIVER_IMPORT.test(s), s).toBe(true);
    }
    expect(DRIVER_IMPORT.test(`from '@stoktok/db/pg'`)).toBe(false);
  });
});
