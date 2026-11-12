import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'coverage']);
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|zip|gz|tgz)$/i;
const MAX_BYTES = 1024 * 1024;
const BASELINE = 'db/migrations/20261111000200_baseline.sql';

// Old Supabase migration and rollback paths, with either separator.
const NEEDLE = /supabase[\\/]+(migrations|rollback)/;

/** Root-relative prefixes and exact paths where the old paths may appear. */
export function isAllowed(rel: string): boolean {
  return ['supabase/', 'work/', 'docs/', '.claude/'].some((p) => rel.startsWith(p)) || rel === 'scripts/schema-diff.sh';
}

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(full);
    } else if (e.isFile()) {
      // Never load secret files into a test.
      if (e.name === '.env' || (e.name.startsWith('.env.') && e.name !== '.env.example')) continue;
      if (BINARY_EXT.test(e.name) || lstatSync(full).size > MAX_BYTES) continue;
      yield full;
    }
  }
}

/** `path:line` of every needle match outside the allowlist. Never the line content. */
function findOffenders(): string[] {
  const out: string[] = [];
  for (const full of walk(ROOT)) {
    const rel = full.slice(ROOT.length + 1).split(sep).join('/');
    if (isAllowed(rel)) continue;
    const lines = readFileSync(full, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // The frozen baseline keeps its provenance comment on line 1.
      if (rel === BASELINE && i === 0) return;
      if (NEEDLE.test(line)) out.push(`${rel}:${i + 1}`);
    });
  }
  return out;
}

describe('legacy reference guard', () => {
  test('no legacy migration paths outside the allowlist', () => {
    expect(findOffenders()).toEqual([]);
  });

  test('matcher fixtures', () => {
    expect(NEEDLE.test(['ls supabase', 'migrations/*.sql'].join('/'))).toBe(true);
    expect(NEEDLE.test(['supabase', 'rollback', 'x.down.sql'].join('\\'))).toBe(true);
    expect(NEEDLE.test('supabase/legacy/bootstrap-roles.sql')).toBe(false);
    expect(NEEDLE.test('the old `supabase/` migration history')).toBe(false);
  });

  test('allowlist fixtures', () => {
    for (const p of ['work/x.md', 'docs/a/b.md', '.claude/x', 'supabase/x.sql', 'scripts/schema-diff.sh']) expect(isAllowed(p), p).toBe(true);
    for (const p of ['apps/work/x.md', 'scripts/db-check.sh', 'packages/db/src/legacy-reference-guard.test.ts']) expect(isAllowed(p), p).toBe(false);
  });
});
