import { RateLimitError } from '@anthropic-ai/sdk';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { AI_CONFIG } from '@stoktok/core';
import { AiClient } from '../client';
import { FakeLedger, seqRng } from '../fakes';
import { anthropicFinalOutput, anthropicOneToolUse, anthropicText, anthropicToolUse } from '../__fixtures__/anthropic';
import { ProviderError, type ProviderRequest, type ReadTool } from '../types';
import { createAnthropicProvider, type AnthropicMessagesClient } from './anthropic';

type Call = { params: Record<string, unknown>; opts?: { signal?: AbortSignal } };
function fake(...steps: unknown[]) {
  const calls: Call[] = [];
  const client: AnthropicMessagesClient = {
    messages: {
      async create(params, opts) {
        calls.push({ params, opts });
        const s = steps.shift();
        if (s instanceof Error || (s && typeof s === 'object' && 'throw' in (s as object))) throw s instanceof Error ? s : (s as { throw: unknown }).throw;
        return s;
      },
    },
  };
  return { calls, provider: createAnthropicProvider({ client }) };
}

const req = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  model: 'claude-x',
  system: 'sys',
  messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
  tools: [],
  maxOutputTokens: 500,
  thinkingBudgetTokens: 0,
  signal: new AbortController().signal,
  ...over,
});
const tool = { name: 'get_price', description: 'price', inputSchema: { $schema: 'x', type: 'object', properties: {} } };
const out = { jsonSchema: { type: 'object', properties: { summary: { type: 'string' } } } };
const withUsage = (usage: unknown) => ({ ...anthropicText, usage });
const withStop = (stop_reason: unknown) => ({ ...anthropicText, stop_reason });

describe('anthropic request', () => {
  test('maps system, text, tool_call, tool_result and drops empty text', async () => {
    const { calls, provider } = fake(anthropicText);
    await provider.generate(
      req({
        messages: [
          { role: 'user', parts: [{ type: 'text', text: 'hi' }, { type: 'text', text: '' }] },
          { role: 'assistant', parts: [{ type: 'tool_call', id: 't1', name: 'get_price', input: { a: 1 } }] },
          { role: 'user', parts: [{ type: 'tool_result', id: 't1', name: 'get_price', text: 'res' }] },
        ],
      }),
    );
    expect(calls[0]?.params).toMatchObject({
      system: 'sys',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'get_price', input: { a: 1 } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'res' }] },
      ],
    });
  });
  test('maps ToolDef without $schema; no tools and no output omits tools', async () => {
    const a = fake(anthropicText, anthropicText);
    await a.provider.generate(req({ tools: [tool] }));
    expect(a.calls[0]?.params.tools).toEqual([{ name: 'get_price', description: 'price', input_schema: { type: 'object', properties: {} } }]);
    await a.provider.generate(req());
    expect(a.calls[1]?.params).not.toHaveProperty('tools');
    expect(a.calls[1]?.params).not.toHaveProperty('tool_choice');
  });
  test('sets max_tokens and disables thinking from the request; passes the signal', async () => {
    const { calls, provider } = fake(anthropicText);
    const r = req({ maxOutputTokens: 700 });
    await provider.generate(r);
    expect(calls[0]?.params).toMatchObject({ model: 'claude-x', max_tokens: 700, thinking: { type: 'disabled' } });
    expect(calls[0]?.opts?.signal).toBe(r.signal);
  });
  test('rejects thinkingBudgetTokens > 0 without calling the API', async () => {
    const { calls, provider } = fake(anthropicText);
    await expect(provider.generate(req({ thinkingBudgetTokens: 1024 }))).rejects.toMatchObject({ code: 'malformed', usage: null });
    expect(calls).toHaveLength(0);
  });
  test('forces final_output on the final round; auto beside read tools', async () => {
    const a = fake(anthropicFinalOutput, anthropicFinalOutput);
    await a.provider.generate(req({ output: out }));
    expect(a.calls[0]?.params.tool_choice).toEqual({ type: 'tool', name: 'final_output' });
    expect((a.calls[0]?.params.tools as { name: string }[]).map((t) => t.name)).toEqual(['final_output']);
    await a.provider.generate(req({ output: out, tools: [tool] }));
    expect(a.calls[1]?.params.tool_choice).toEqual({ type: 'auto' });
    expect((a.calls[1]?.params.tools as { name: string }[]).map((t) => t.name)).toEqual(['get_price', 'final_output']);
  });
});

describe('anthropic response', () => {
  test('text, end_turn -> end', async () => {
    const r = await fake(anthropicText).provider.generate(req());
    expect(r).toEqual({ parts: [{ type: 'text', text: 'xin chao' }], stop: 'end', usage: { inputTokens: 120, outputTokens: 40 } });
  });
  test('three tool_use -> three tool_call parts', async () => {
    const r = await fake(anthropicToolUse).provider.generate(req({ tools: [tool] }));
    expect(r.stop).toBe('tool_use');
    expect(r.parts.filter((p) => p.type === 'tool_call')).toHaveLength(3);
  });
  test('final_output call -> json part, stop end; wrapped schema unwrapped', async () => {
    const a = await fake(anthropicFinalOutput).provider.generate(req({ output: out }));
    expect(a).toMatchObject({ parts: [{ type: 'json', value: { summary: 'ok' } }], stop: 'end' });
    const wrapped = { ...anthropicText, content: [{ type: 'tool_use', id: 'x', name: 'final_output', input: { value: ['a'] } }], stop_reason: 'tool_use' };
    const b = await fake(wrapped).provider.generate(req({ output: { jsonSchema: { type: 'array' } } }));
    expect(b.parts).toEqual([{ type: 'json', value: ['a'] }]);
  });
  test('final_output with a read tool call -> malformed with usage', async () => {
    const mixed = { ...anthropicText, content: [...anthropicFinalOutput.content, ...anthropicOneToolUse.content], stop_reason: 'tool_use' };
    await expect(fake(mixed).provider.generate(req({ output: out }))).rejects.toMatchObject({ code: 'malformed', usage: { inputTokens: 120 } });
  });
  test.each([
    ['end_turn', 'end'],
    ['stop_sequence', 'end'],
    ['tool_use', 'tool_use'],
    ['max_tokens', 'max_tokens'],
    ['model_context_window_exceeded', 'max_tokens'],
  ])('stop_reason %s -> %s', async (reason, stop) => {
    expect((await fake(withStop(reason)).provider.generate(req())).stop).toBe(stop);
  });
  test.each([
    ['refusal', 'refused'],
    ['pause_turn', 'malformed'],
    ['weird', 'malformed'],
  ])('stop_reason %s throws %s with usage', async (reason, code) => {
    await expect(fake(withStop(reason)).provider.generate(req())).rejects.toMatchObject({ code, usage: { inputTokens: 120, outputTokens: 40 } });
  });
  test('thinking and redacted_thinking blocks -> malformed with usage', async () => {
    for (const type of ['thinking', 'redacted_thinking']) {
      const raw = { ...anthropicText, content: [{ type, thinking: 'x' }] };
      await expect(fake(raw).provider.generate(req())).rejects.toMatchObject({ code: 'malformed', usage: { inputTokens: 120 } });
    }
  });
  test('usage = input + cache creation + cache read; output = output_tokens', async () => {
    const r = await fake(withUsage({ input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 30, output_tokens: 5 })).provider.generate(req());
    expect(r.usage).toEqual({ inputTokens: 60, outputTokens: 5 });
  });
  test.each([[undefined], [{ input_tokens: 1 }], [{ input_tokens: 1.5, output_tokens: 1 }], [{ input_tokens: -1, output_tokens: 1 }], [{ input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 'x' }]])(
    'missing or invalid usage %j -> malformed with null usage',
    async (u) => {
      await expect(fake(withUsage(u)).provider.generate(req())).rejects.toMatchObject({ code: 'malformed', usage: null });
    },
  );
});

describe('anthropic errors', () => {
  test.each([
    [{ status: 429 }, 'rate_limited'],
    [{ status: 529 }, 'rate_limited'],
    [{ status: 500 }, 'http'],
    [{ name: 'AbortError' }, 'timeout'],
    [{ name: 'APIConnectionTimeoutError' }, 'timeout'],
  ])('%j -> %s', async (thrown, code) => {
    const err = await fake({ throw: thrown }).provider.generate(req()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ code, usage: null });
  });
  test('real SDK RateLimitError -> rate_limited', async () => {
    const e = new RateLimitError(429, undefined, 'slow down', new Headers());
    await expect(fake(e).provider.generate(req())).rejects.toMatchObject({ code: 'rate_limited' });
  });
});

describe('anthropic through AiClient', () => {
  test('tool call then final_output', async () => {
    const { provider, calls } = fake(anthropicOneToolUse, anthropicFinalOutput);
    const ledger = new FakeLedger(AI_CONFIG.budget.capMicroUsd);
    const client = new AiClient({ providers: { anthropic: provider }, ledger, log: { warn: () => undefined }, rng: seqRng(), clock: () => new Date('2026-11-10T00:00:00Z') });
    const priceTool: ReadTool = { kind: 'read', name: 'get_price', description: 'price', input: z.object({ symbol: z.string() }), maxResultBytes: 1000, run: async () => 'FPT 100000' };
    const r = await client.generate({ task: 'chat', system: 's', messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }], tools: [priceTool], output: z.object({ summary: z.string() }) });
    expect(r).toMatchObject({ ok: true, value: { summary: 'ok' }, provider: 'anthropic' });
    expect(calls).toHaveLength(2);
    expect(ledger.settles.every((s) => s.settle.status === 'ok')).toBe(true);
  });
});
