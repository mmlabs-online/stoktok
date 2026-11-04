import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appDir = path.resolve(__dirname, '../app');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const rel = (f: string) => path.relative(appDir, f).split(path.sep).join('/');
const exempt = (f: string) => rel(f).startsWith('login/') || rel(f) === 'healthz/route.ts';
const all = walk(appDir).filter((f) => !exempt(f));

describe('R6 entry points', () => {
  it('every page.tsx and route.ts outside /login and /healthz calls await requireUser()', () => {
    const entries = all.filter((f) => /(^|\/)(page\.tsx|route\.ts)$/.test(rel(f)));
    expect(entries.length).toBeGreaterThan(0);
    for (const f of entries) expect(fs.readFileSync(f, 'utf8'), rel(f)).toMatch(/await requireUser\(\)/);
  });

  it("every exported function in non-login 'use server' files calls await requireUser() before getDb(", () => {
    const files = all.filter((f) => /\.tsx?$/.test(f) && /^\s*['"]use server['"]/.test(fs.readFileSync(f, 'utf8')));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      const parts = src.split(/^export (?:async function |function |const \w+ = async )/m).slice(1);
      expect(parts.length, rel(f)).toBeGreaterThan(0);
      for (const body of parts) {
        const auth = body.indexOf('await requireUser()');
        const db = body.indexOf('getDb(');
        expect(auth, `${rel(f)}: ${body.slice(0, 40)}`).toBeGreaterThan(-1);
        if (db !== -1) expect(auth).toBeLessThan(db);
      }
    }
  });
});
