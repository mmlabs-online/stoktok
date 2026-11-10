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

const files = [...walk(join(ROOT, 'apps')), ...walk(join(ROOT, 'packages'))]
  .filter((p) => !p.endsWith('r3-guard.test.ts') && !p.endsWith('next-env.d.ts'))
  .map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));

describe('R3 guard', () => {
  test('.env.example has no NEXT_PUBLIC_ key', () => {
    const env = readFileSync(join(ROOT, '.env.example'), 'utf8');
    expect(env.split('\n').filter((l) => /^\s*NEXT_PUBLIC_/.test(l))).toEqual([]);
  });

  test('no source file contains NEXT_PUBLIC_ next to SERVICE or KEY', () => {
    const bad = files.filter((f) => /NEXT_PUBLIC_\w*(SERVICE|KEY)/.test(f.text)).map((f) => f.path);
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
    const importers = files.filter((f) => /from '@stoktok\/db'/.test(f.text)).map((f) => f.path);
    expect(importers.filter((p) => p.startsWith('apps/web/'))).toEqual(['apps/web/server/db.ts']);
  });

  test('AI key names appear only in packages/ai/src/env.ts and env.test.ts', () => {
    const hits = files
      .filter((f) => /ANTHROPIC_API_KEY|GOOGLE_AI_API_KEY/.test(f.text))
      .map((f) => f.path)
      .filter((p) => p !== 'packages/ai/src/env.ts' && p !== 'packages/ai/src/env.test.ts');
    expect(hits).toEqual([]);
  });

  test('AI SDKs (@anthropic-ai/sdk, @google/genai) are imported only under packages/ai/', () => {
    const sdk = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:@anthropic-ai\/sdk|@google\/genai)/;
    const hits = files.filter((f) => sdk.test(f.text)).map((f) => f.path).filter((p) => !p.startsWith('packages/ai/'));
    expect(hits).toEqual([]);
  });

  test('apps/web importers of @stoktok/ai are only apps/web/server/ai.ts', () => {
    const importers = files.filter((f) => /from '@stoktok\/ai(?:\/[\w-]+)?'/.test(f.text)).map((f) => f.path);
    expect(importers.filter((p) => p.startsWith('apps/web/')).filter((p) => p !== 'apps/web/server/ai.ts')).toEqual([]);
  });
});
