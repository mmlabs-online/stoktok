import { describe, expect, test } from 'vitest';
import { aiMessage, formatUsdMicro, type AiMessageCode } from './messages-vi';

describe('ai messages', () => {
  test('formatUsdMicro: 4_000_000 -> "4,00 USD", 1 -> "0,01 USD" (rounded up), 0 -> "0,00 USD"', () => {
    expect(formatUsdMicro(4_000_000)).toBe('4,00 USD');
    expect(formatUsdMicro(1)).toBe('0,01 USD');
    expect(formatUsdMicro(0)).toBe('0,00 USD');
  });
  test('budget_exhausted text contains "5,00 USD" and "ngày 1 tháng sau"', () => {
    const t = aiMessage('budget_exhausted', { capMicroUsd: 5_000_000 });
    expect(t).toContain('5,00 USD');
    expect(t).toContain('ngày 1 tháng sau');
  });
  test('budget_warn text contains the percent and spent/cap', () => {
    const t = aiMessage('budget_warn', { percent: 80, spentMicroUsd: 4_000_000, capMicroUsd: 5_000_000 });
    expect(t).toContain('80%');
    expect(t).toContain('4,00 USD / 5,00 USD');
  });
  test('every AiMessageCode has a non-empty message', () => {
    const codes: AiMessageCode[] = ['budget_exhausted', 'budget_warn', 'provider_unavailable', 'provider_error', 'invalid_output'];
    for (const c of codes) expect(aiMessage(c).length).toBeGreaterThan(0);
  });
});
