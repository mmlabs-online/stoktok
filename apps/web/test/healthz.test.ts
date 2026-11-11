import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../app/healthz/route';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /healthz', () => {
  it('returns 200 with status ok', async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('ok');
  });

  it('echoes STOKTOK_VERSION, null when unset', async () => {
    vi.stubEnv('STOKTOK_VERSION', 'v0.1.0');
    expect((await GET().json()).version).toBe('v0.1.0');
    vi.stubEnv('STOKTOK_VERSION', undefined);
    expect((await GET().json()).version).toBeNull();
  });

  it('sets cache-control no-store', () => {
    expect(GET().headers.get('cache-control')).toBe('no-store');
  });

  it('answers with no env set', () => {
    expect(GET().status).toBe(200);
  });

  it('route source imports nothing from db/supabase/server modules', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../app/healthz/route.ts'), 'utf8');
    expect(src).not.toMatch(/\b(import|require)\b[^\n]*(@stoktok\/db|@supabase\/|server-only|\.\.\/lib|@\/lib)/);
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
