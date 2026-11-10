import { describe, expect, test } from 'vitest';
import { AI_CONFIG, type AiConfig } from './config';
import { AiConfigError, usageCostMicroUsd, utf8ByteLength, worstCaseCostMicroUsd } from './cost';

describe('usageCostMicroUsd', () => {
  test('1M input tokens of claude-sonnet-4-5 = 3_000_000 micro-USD', () => {
    expect(usageCostMicroUsd('claude-sonnet-4-5', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(3_000_000);
  });
  test('1 output token of gemini-2.5-flash = ceil(2.5) = 3 micro-USD', () => {
    expect(usageCostMicroUsd('gemini-2.5-flash', { inputTokens: 0, outputTokens: 1 })).toBe(3);
  });
  test('ceil applied once on the summed numerator', () => {
    // gemini: 1 in = 0.3, 1 out = 2.5 -> sum 2.8 -> 3 (per-part ceil would give 1 + 3 = 4)
    expect(usageCostMicroUsd('gemini-2.5-flash', { inputTokens: 1, outputTokens: 1 })).toBe(3);
  });
  test('thinking tokens are priced as output', () => {
    // 1000 reported output tokens incl. thinking at 5 micro-USD each
    expect(usageCostMicroUsd('claude-haiku-4-5', { inputTokens: 0, outputTokens: 1000 })).toBe(5000);
  });
  test('0 tokens = 0', () => {
    expect(usageCostMicroUsd('claude-haiku-4-5', { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
  test('very large counts stay exact', () => {
    expect(usageCostMicroUsd('claude-sonnet-4-5', { inputTokens: 2_000_000_000_001, outputTokens: 0 })).toBe(6_000_000_000_003);
  });
  test('unpriced model throws AiConfigError', () => {
    expect(() => usageCostMicroUsd('nope', { inputTokens: 1, outputTokens: 1 })).toThrow(AiConfigError);
  });
  test('negative, fractional or unsafe token counts throw RangeError', () => {
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => usageCostMicroUsd('claude-haiku-4-5', { inputTokens: bad, outputTokens: 0 })).toThrow(RangeError);
      expect(() => usageCostMicroUsd('claude-haiku-4-5', { inputTokens: 0, outputTokens: bad })).toThrow(RangeError);
    }
  });
});

describe('worstCaseCostMicroUsd', () => {
  test("worst case uses UTF-8 bytes: 'Đầu tư' counts 10 bytes", () => {
    expect(utf8ByteLength('Đầu tư')).toBe(10);
    expect(utf8ByteLength('a', 'Đ')).toBe(3);
  });
  test('worst case adds perMessageOverheadTokens x messageCount', () => {
    const a = worstCaseCostMicroUsd('summary', 'claude-haiku-4-5', { inputUtf8Bytes: 0, messageCount: 0 });
    const b = worstCaseCostMicroUsd('summary', 'claude-haiku-4-5', { inputUtf8Bytes: 0, messageCount: 1_000_000 / 16 });
    expect(b - a).toBe(1_000_000 * 1); // 1M input tokens at 1 micro-USD each
  });
  test('worst case adds (maxOutputTokens + thinkingBudgetTokens) at output price for the task', () => {
    const cfg = (JSON.parse(JSON.stringify(AI_CONFIG)) as AiConfig);
    cfg.thinkingBudgetTokensByTask.chat = 500;
    // chat: 2000 + 500 output tokens of sonnet at 15 micro-USD
    expect(worstCaseCostMicroUsd('chat', 'claude-sonnet-4-5', { inputUtf8Bytes: 0, messageCount: 0 }, cfg)).toBe(2500 * 15);
  });
  test('worst case >= usageCostMicroUsd for any usage within the bounds', () => {
    const cases = [
      { bytes: 100, msgs: 1, inTok: 30, outTok: 1000 },
      { bytes: 100, msgs: 1, inTok: 116, outTok: 1000 },
      { bytes: 5000, msgs: 3, inTok: 2000, outTok: 1 },
      { bytes: 0, msgs: 0, inTok: 0, outTok: 0 },
      { bytes: 12345, msgs: 7, inTok: 12457, outTok: 1000 },
    ];
    for (const c of cases) {
      const worst = worstCaseCostMicroUsd('explanation', 'gemini-2.5-flash', { inputUtf8Bytes: c.bytes, messageCount: c.msgs });
      expect(worst).toBeGreaterThanOrEqual(usageCostMicroUsd('gemini-2.5-flash', { inputTokens: c.inTok, outputTokens: c.outTok }));
    }
  });
});
