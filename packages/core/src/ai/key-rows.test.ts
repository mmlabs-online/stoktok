import { describe, expect, it } from 'vitest';
import { AI_PROVIDERS } from './config';
import { aiKeyMessage, aiKeyRows } from './key-rows';
import type { AiKeyErrorCode } from './key-rows';

const none = { anthropic: false, google: false };

describe('aiKeyRows', () => {
  it('no meta, no env -> none', () => {
    for (const r of aiKeyRows([], none)) {
      expect(r.state).toBe('none');
      expect(r.last4).toBeUndefined();
      expect(r.savedOn).toBeUndefined();
    }
  });
  it('ui row has last4 and date', () => {
    const rows = aiKeyRows([{ provider: 'anthropic', last4: 'wxyz', updatedAt: '2026-11-10T03:00:00Z' }], none);
    expect(rows[0]).toMatchObject({ provider: 'anthropic', state: 'ui', last4: 'wxyz', savedOn: '10/11/2026' });
    expect(rows[1]?.state).toBe('none');
  });
  it('uses the Vietnam date', () => {
    const rows = aiKeyRows([{ provider: 'anthropic', last4: 'wxyz', updatedAt: '2026-11-10T18:30:00Z' }], none);
    expect(rows[0]?.savedOn).toBe('11/11/2026');
  });
  it('env only', () => {
    const r = aiKeyRows([], { anthropic: true, google: false })[0]!;
    expect(r).toMatchObject({ state: 'env', envFallback: true });
    expect(r.last4).toBeUndefined();
    expect(r.savedOn).toBeUndefined();
  });
  it('ui wins over env', () => {
    const r = aiKeyRows([{ provider: 'google', last4: 'abcd', updatedAt: '2026-11-10T03:00:00Z' }], { anthropic: false, google: true })[1]!;
    expect(r).toMatchObject({ state: 'ui', envFallback: true });
  });
  it('AI_PROVIDERS order, labels, unknown providers ignored', () => {
    const rows = aiKeyRows([{ provider: 'openai', last4: 'abcd', updatedAt: '2026-11-10T03:00:00Z' }], none);
    expect(rows.map((r) => r.provider)).toEqual([...AI_PROVIDERS]);
    expect(rows.map((r) => r.label)).toEqual(['Anthropic', 'Google AI']);
    expect(rows.every((r) => r.state === 'none')).toBe(true);
  });
});

describe('aiKeyMessage', () => {
  const codes: AiKeyErrorCode[] = ['AI_KEY_EMPTY', 'AI_KEY_WHITESPACE', 'AI_KEY_LENGTH', 'AI_KEY_CHARSET', 'AI_KEY_PROVIDER', 'AI_KEY_DB_ERROR'];
  it('fixed non-empty string for every code and op', () => {
    for (const c of codes) for (const op of ['save', 'delete'] as const) expect(aiKeyMessage(c, op).length).toBeGreaterThan(0);
  });
  it('length message names the bounds', () => {
    expect(aiKeyMessage('AI_KEY_LENGTH', 'save')).toContain('20');
    expect(aiKeyMessage('AI_KEY_LENGTH', 'save')).toContain('256');
  });
});
