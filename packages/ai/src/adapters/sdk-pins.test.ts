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
