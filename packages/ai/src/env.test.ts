import { describe, expect, test } from 'vitest';
import { readAiEnv } from './env';

describe('readAiEnv', () => {
  test('both set: returned trimmed', () => {
    expect(readAiEnv({ ANTHROPIC_API_KEY: ' a ', GOOGLE_AI_API_KEY: '\tg\n' })).toEqual({ anthropicApiKey: 'a', googleAiApiKey: 'g' });
  });
  test("'' , '   ' and undefined count as missing", () => {
    expect(readAiEnv({ ANTHROPIC_API_KEY: '', GOOGLE_AI_API_KEY: '   ' })).toEqual({});
    expect(readAiEnv({})).toEqual({});
  });
  test('one set: only that one', () => {
    expect(readAiEnv({ GOOGLE_AI_API_KEY: 'g' })).toEqual({ googleAiApiKey: 'g' });
  });
});
