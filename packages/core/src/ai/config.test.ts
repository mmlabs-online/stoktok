import { describe, expect, test } from 'vitest';
import { AI_CONFIG, AI_PROVIDERS, AI_TASKS, validateAiConfig, type AiConfig } from './config';

const clone = (): AiConfig => (JSON.parse(JSON.stringify(AI_CONFIG)) as AiConfig);

describe('AI_CONFIG', () => {
  test('AI_CONFIG is valid', () => {
    expect(validateAiConfig(AI_CONFIG)).toEqual([]);
    expect(AI_CONFIG.budget).toEqual({ capMicroUsd: 5_000_000, warnPpm: 800_000, timeZone: 'Asia/Ho_Chi_Minh' });
  });
  test('every model in modelsByTask has a price row', () => {
    for (const p of AI_PROVIDERS) for (const t of AI_TASKS) expect(AI_CONFIG.priceTable[AI_CONFIG.modelsByTask[p][t]]).toBeDefined();
  });
});

describe('validateAiConfig rejects', () => {
  test('unpriced model', () => {
    const c = clone();
    c.modelsByTask.google.chat = 'gemini-unpriced';
    expect(validateAiConfig(c)).not.toEqual([]);
  });
  test.each([
    ['cap <= 0', (c: AiConfig) => (c.budget.capMicroUsd = 0)],
    ['non-integer cap', (c: AiConfig) => (c.budget.capMicroUsd = 5.5)],
    ['warnPpm 0', (c: AiConfig) => (c.budget.warnPpm = 0)],
    ['warnPpm 1_000_000', (c: AiConfig) => (c.budget.warnPpm = 1_000_000)],
    ['non-integer price', (c: AiConfig) => (c.priceTable['claude-sonnet-4-5']!.inMicroUsdPerMTok = 1.5)],
    ['negative price', (c: AiConfig) => (c.priceTable['claude-sonnet-4-5']!.outMicroUsdPerMTok = -1)],
    ['zero input price', (c: AiConfig) => (c.priceTable['claude-sonnet-4-5']!.inMicroUsdPerMTok = 0)],
    ['zero output price', (c: AiConfig) => (c.priceTable['claude-sonnet-4-5']!.outMicroUsdPerMTok = 0)],
    ['another time zone', (c: AiConfig) => (c.budget.timeZone = 'UTC')],
    ['maxOutputTokens <= 0', (c: AiConfig) => (c.maxOutputTokensByTask.chat = 0)],
  ])('%s', (_name, mutate) => {
    const c = clone();
    mutate(c);
    expect(validateAiConfig(c).length).toBeGreaterThan(0);
  });
});
