import { describe, expect, test } from 'vitest';
import { makeProviderResolver, resolveAiKeys } from './keys';

const ENV = { anthropicApiKey: 'DUMMY-env-anthropic', googleAiApiKey: 'DUMMY-env-google' };

describe('resolveAiKeys', () => {
  test('stored and env both set: the stored key wins, source ui', () => {
    const r = resolveAiKeys({ google: 'DUMMY-ui-google' }, ENV);
    expect(r.keys.googleAiApiKey).toBe('DUMMY-ui-google');
    expect(r.source.google).toBe('ui');
  });
  test('env only: the env key, source env', () => {
    const r = resolveAiKeys({}, ENV);
    expect(r.keys).toEqual(ENV);
    expect(r.source).toEqual({ anthropic: 'env', google: 'env' });
  });
  test('neither: absent, source none', () => {
    const r = resolveAiKeys({}, {});
    expect(r.keys).toEqual({});
    expect(r.source).toEqual({ anthropic: 'none', google: 'none' });
  });
  test('mixed: stored anthropic + env google', () => {
    const r = resolveAiKeys({ anthropic: 'DUMMY-ui-anthropic' }, { googleAiApiKey: 'DUMMY-env-google' });
    expect(r.keys).toEqual({ anthropicApiKey: 'DUMMY-ui-anthropic', googleAiApiKey: 'DUMMY-env-google' });
    expect(r.source).toEqual({ anthropic: 'ui', google: 'env' });
  });
  test('after a delete (stored empty): env if present, else none', () => {
    expect(resolveAiKeys({}, { googleAiApiKey: 'DUMMY-env-google' }).source.google).toBe('env');
    expect(resolveAiKeys({}, {}).source.google).toBe('none');
  });
  test('a blank or whitespace stored value counts as absent', () => {
    const r = resolveAiKeys({ anthropic: '', google: '   ' }, ENV);
    expect(r.source).toEqual({ anthropic: 'env', google: 'env' });
  });
});

describe('makeProviderResolver', () => {
  test('reads stored and env on every call and reflects a stored change', async () => {
    let stored: Record<string, string> = { google: 'DUMMY-ui-google' };
    let reads = 0;
    let envReads = 0;
    const resolve = makeProviderResolver(
      async () => {
        reads++;
        return stored;
      },
      () => {
        envReads++;
        return {};
      },
      { timeoutMs: 1000 },
    );
    expect(Object.keys(await resolve())).toEqual(['google']);
    stored = { anthropic: 'DUMMY-ui-anthropic' };
    expect(Object.keys(await resolve())).toEqual(['anthropic']);
    expect([reads, envReads]).toEqual([2, 2]);
  });
  test('a readStored rejection propagates and does not fall back to env', async () => {
    const resolve = makeProviderResolver(
      async () => {
        throw new Error('read failed');
      },
      () => ENV,
      { timeoutMs: 1000 },
    );
    await expect(resolve()).rejects.toThrow('read failed');
  });
});
