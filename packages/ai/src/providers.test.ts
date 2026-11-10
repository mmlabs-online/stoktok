import { describe, expect, test } from 'vitest';
import { buildProviders } from './providers';

describe('buildProviders', () => {
  test('{} -> {}', () => expect(buildProviders({})).toEqual({}));
  test('anthropic only', () => {
    const p = buildProviders({ anthropicApiKey: 'k' });
    expect(Object.keys(p)).toEqual(['anthropic']);
    expect(p.anthropic?.id).toBe('anthropic');
  });
  test('google only', () => {
    const p = buildProviders({ googleAiApiKey: 'k' });
    expect(Object.keys(p)).toEqual(['google']);
    expect(p.google?.id).toBe('google');
  });
  test('both', () => {
    const p = buildProviders({ anthropicApiKey: 'a', googleAiApiKey: 'g' });
    expect(p.anthropic?.id).toBe('anthropic');
    expect(p.google?.id).toBe('google');
  });
});
