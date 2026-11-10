import { describe, expect, test } from 'vitest';
import { AI_CONFIG, type AiConfig } from './config';
import { selectProvider } from './select-provider';

describe('selectProvider', () => {
  test('summary/explanation default google, chat default anthropic', () => {
    const both = ['anthropic', 'google'] as const;
    expect(selectProvider({ task: 'summary', enabled: both })).toMatchObject({ ok: true, provider: 'google' });
    expect(selectProvider({ task: 'explanation', enabled: both })).toMatchObject({ ok: true, provider: 'google' });
    expect(selectProvider({ task: 'chat', enabled: both })).toMatchObject({ ok: true, provider: 'anthropic' });
  });
  test('default disabled, other enabled -> other provider with its model for the task', () => {
    expect(selectProvider({ task: 'summary', enabled: ['anthropic'] })).toEqual({ ok: true, provider: 'anthropic', model: 'claude-haiku-4-5' });
  });
  test('explicit provider disabled -> provider_unavailable', () => {
    expect(selectProvider({ task: 'chat', requested: 'anthropic', enabled: ['google'] })).toEqual({ ok: false, reason: 'provider_unavailable' });
  });
  test('explicit provider enabled is used', () => {
    expect(selectProvider({ task: 'summary', requested: 'anthropic', enabled: ['anthropic', 'google'] })).toMatchObject({ ok: true, provider: 'anthropic' });
  });
  test('no provider enabled -> provider_unavailable', () => {
    expect(selectProvider({ task: 'chat', enabled: [] })).toEqual({ ok: false, reason: 'provider_unavailable' });
  });
  test('returns the configured model, not a hard-coded one', () => {
    const cfg = (JSON.parse(JSON.stringify(AI_CONFIG)) as AiConfig);
    cfg.modelsByTask.google.summary = 'gemini-custom';
    expect(selectProvider({ task: 'summary', enabled: ['google'] }, cfg)).toEqual({ ok: true, provider: 'google', model: 'gemini-custom' });
  });
});
