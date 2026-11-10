import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const seen = vi.hoisted(() => ({ anthropic: [] as unknown[], google: [] as unknown[] }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor(o: unknown) {
      seen.anthropic.push(o);
    }
  },
}));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor(o: unknown) {
      seen.google.push(o);
    }
  },
}));

import { createAnthropicProvider } from './anthropic';
import { createGoogleProvider } from './google';

beforeEach(() => {
  seen.anthropic.length = 0;
  seen.google.length = 0;
});

describe('SDK construction is pinned', () => {
  test('anthropic: fixed base URL, no env auth token, logging off', () => {
    createAnthropicProvider({ apiKey: 'k' });
    expect(seen.anthropic[0]).toMatchObject({ apiKey: 'k', baseURL: 'https://api.anthropic.com', authToken: null, logLevel: 'off' });
  });
  test('google: fixed base URL, no Vertex', () => {
    createGoogleProvider({ apiKey: 'k' });
    expect(seen.google[0]).toMatchObject({ apiKey: 'k', vertexai: false, httpOptions: { baseUrl: 'https://generativelanguage.googleapis.com' } });
  });
});

describe('SDK versions are pinned identically', () => {
  test('web, worker and ai package.json pin identical exact SDK versions', () => {
    const root = join(__dirname, '..', '..', '..', '..');
    const read = (p: string) => JSON.parse(readFileSync(join(root, p, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    for (const name of ['@anthropic-ai/sdk', '@google/genai']) {
      const versions = ['packages/ai', 'apps/web', 'apps/worker'].map((p) => read(p).dependencies[name]);
      expect(versions[0], name).toMatch(/^\d+\.\d+\.\d+$/);
      expect(new Set(versions).size, `${name} ${versions.join(' ')}`).toBe(1);
    }
  });
});
