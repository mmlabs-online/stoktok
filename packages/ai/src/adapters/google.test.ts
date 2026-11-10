import { ApiError } from '@google/genai';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { AI_CONFIG } from '@stoktok/core';
import { AiClient } from '../client';
import { FakeLedger, seqRng } from '../fakes';
import { googleFinalOutput, googleJsonText, googleText, googleToolCalls, googleWith } from '../__fixtures__/google';
import { ProviderError, type ProviderRequest, type ReadTool } from '../types';
import { createGoogleProvider, type GoogleModelsClient } from './google';

function fake(...steps: unknown[]) {
  const calls: { contents?: unknown; config: Record<string, unknown> & { tools: { functionDeclarations: { name: string }[] }[] } }[] = [];
  const client: GoogleModelsClient = {
    models: {
      async generateContent(params) {
        calls.push(params as never);
        const s = steps.shift();
        if (s instanceof Error) throw s;
        if (s && typeof s === 'object' && 'throw' in s) throw (s as { throw: unknown }).throw;
        return s;
      },
    },
  };
  return { calls, provider: createGoogleProvider({ client }) };
}

const req = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  model: 'gemini-x',
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

describe('google request', () => {
  test('maps system, roles, functionCall, functionResponse; synthetic ids omitted, real ids echoed', async () => {
    const { calls, provider } = fake(googleText);
    await provider.generate(
      req({
        messages: [
          { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
          { role: 'assistant', parts: [{ type: 'tool_call', id: 'gsyn_0_0', name: 'get_price', input: { a: 1 } }, { type: 'tool_call', id: 'real1', name: 'get_price', input: {} }] },
          { role: 'user', parts: [{ type: 'tool_result', id: 'gsyn_0_0', name: 'get_price', text: 'res' }, { type: 'tool_result', id: 'real1', name: 'get_price', text: 'r2' }] },
        ],
      }),
    );
    expect(calls[0]?.contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ functionCall: { name: 'get_price', args: { a: 1 } } }, { functionCall: { name: 'get_price', args: {}, id: 'real1' } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'get_price', response: { result: 'res' } } }, { functionResponse: { name: 'get_price', response: { result: 'r2' }, id: 'real1' } }] },
    ]);
    expect(calls[0]?.config.systemInstruction).toBe('sys');
  });
  test('tools go in functionDeclarations with parametersJsonSchema', async () => {
    const { calls, provider } = fake(googleText);
    await provider.generate(req({ tools: [tool] }));
    expect(calls[0]?.config.tools).toEqual([{ functionDeclarations: [{ name: 'get_price', description: 'price', parametersJsonSchema: { type: 'object', properties: {} } }] }]);
  });
  test('sets maxOutputTokens and thinkingConfig from the request; passes the signal', async () => {
    const { calls, provider } = fake(googleText);
    const r = req({ maxOutputTokens: 700 });
    await provider.generate(r);
    expect(calls[0]?.config).toMatchObject({ maxOutputTokens: 700, thinkingConfig: { thinkingBudget: 0, includeThoughts: false }, abortSignal: r.signal });
  });
  test('rejects thinkingBudgetTokens > 0 without calling the API', async () => {
    const { calls, provider } = fake(googleText);
    await expect(provider.generate(req({ thinkingBudgetTokens: 1024 }))).rejects.toMatchObject({ code: 'malformed', usage: null });
    expect(calls).toHaveLength(0);
  });
  test('uses responseJsonSchema when there are no tools; text comes back as text part', async () => {
    const { calls, provider } = fake(googleJsonText);
    const r = await provider.generate(req({ output: out }));
    expect(calls[0]?.config).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: out.jsonSchema });
    expect(calls[0]?.config).not.toHaveProperty('tools');
    expect(r.parts).toEqual([{ type: 'text', text: '{"summary":"ok"}' }]);
  });
  test('tools + output adds the final_output declaration and no JSON mode', async () => {
    const { calls, provider } = fake(googleFinalOutput);
    const r = await provider.generate(req({ tools: [tool], output: out }));
    expect(calls[0]?.config).not.toHaveProperty('responseMimeType');
    expect(calls[0]?.config.tools[0]?.functionDeclarations.map((d) => d.name)).toEqual(['get_price', 'final_output']);
    expect(r).toMatchObject({ parts: [{ type: 'json', value: { summary: 'ok' } }], stop: 'end' });
  });
});

describe('google response', () => {
  test('function calls without id get synthetic ids by round', async () => {
    const r = await fake(googleToolCalls).provider.generate(
      req({ tools: [tool], messages: [{ role: 'user', parts: [] }, { role: 'assistant', parts: [] }, { role: 'user', parts: [] }] }),
    );
    expect(r.stop).toBe('tool_use');
    expect(r.parts.map((p) => (p.type === 'tool_call' ? p.id : ''))).toEqual(['gsyn_1_0', 'gsyn_1_1']);
  });
  test('final_output with a read call -> malformed with usage', async () => {
    const raw = googleWith([{ functionCall: { name: 'final_output', args: {} } }, { functionCall: { name: 'get_price', args: {} } }]);
    await expect(fake(raw).provider.generate(req({ tools: [tool], output: out }))).rejects.toMatchObject({ code: 'malformed', usage: { inputTokens: 120 } });
  });
  test.each([
    ['STOP', 'end'],
    ['MAX_TOKENS', 'max_tokens'],
  ])('finishReason %s -> %s', async (reason, stop) => {
    expect((await fake(googleWith([{ text: 'a' }], reason)).provider.generate(req())).stop).toBe(stop);
  });
  test.each([
    ...['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].map((r) => [r, 'refused'] as const),
    ...['MALFORMED_FUNCTION_CALL', 'UNEXPECTED_TOOL_CALL', 'OTHER', 'WHATEVER', null].map((r) => [r, 'malformed'] as const),
  ])('finishReason %s throws %s with usage', async (reason, code) => {
    await expect(fake(googleWith([{ text: 'a' }], reason)).provider.generate(req())).rejects.toMatchObject({ code, usage: { inputTokens: 120, outputTokens: 40 } });
  });
  test('no candidates: blockReason -> refused, else malformed', async () => {
    const usageMetadata = { promptTokenCount: 5 };
    await expect(fake({ promptFeedback: { blockReason: 'SAFETY' }, usageMetadata }).provider.generate(req())).rejects.toMatchObject({ code: 'refused', usage: { inputTokens: 5, outputTokens: 0 } });
    await expect(fake({ candidates: [], usageMetadata }).provider.generate(req())).rejects.toMatchObject({ code: 'malformed' });
  });
  test('thought parts dropped; unknown part kinds -> malformed', async () => {
    const r = await fake(googleWith([{ text: 'secret', thought: true }, { text: 'shown' }])).provider.generate(req());
    expect(r.parts).toEqual([{ type: 'text', text: 'shown' }]);
    await expect(fake(googleWith([{ inlineData: {} }])).provider.generate(req())).rejects.toMatchObject({ code: 'malformed', usage: { inputTokens: 120 } });
  });
  test('usage = prompt + toolUsePrompt; output = candidates + thoughts', async () => {
    const meta = { promptTokenCount: 10, toolUsePromptTokenCount: 5, candidatesTokenCount: 7, thoughtsTokenCount: 3, cachedContentTokenCount: 99 };
    expect((await fake(googleWith([{ text: 'a' }], 'STOP', meta)).provider.generate(req())).usage).toEqual({ inputTokens: 15, outputTokens: 10 });
    expect((await fake(googleWith([], 'STOP', { promptTokenCount: 4 })).provider.generate(req())).usage).toEqual({ inputTokens: 4, outputTokens: 0 });
  });
  test.each([[undefined], [{}], [{ promptTokenCount: 1.5 }], [{ promptTokenCount: 1, candidatesTokenCount: -1 }]])('missing or invalid usageMetadata %j -> malformed with null usage', async (meta) => {
    await expect(fake({ ...googleWith([{ text: 'a' }]), usageMetadata: meta }).provider.generate(req())).rejects.toMatchObject({ code: 'malformed', usage: null });
  });
});

describe('google errors', () => {
  test.each([
    [{ status: 429 }, 'rate_limited'],
    [{ status: 500 }, 'http'],
    [{ name: 'AbortError' }, 'timeout'],
  ])('%j -> %s', async (thrown, code) => {
    const err = await fake({ throw: thrown }).provider.generate(req()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ code, usage: null });
  });
  test('real SDK ApiError -> rate_limited / http', async () => {
    await expect(fake(new ApiError({ message: 'x', status: 429 })).provider.generate(req())).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(fake(new ApiError({ message: 'x', status: 503 })).provider.generate(req())).rejects.toMatchObject({ code: 'http' });
  });
});

describe('google through AiClient', () => {
  test('tool call then final_output', async () => {
    const { provider, calls } = fake(googleWith([{ functionCall: { name: 'get_price', args: { symbol: 'FPT' } } }]), googleFinalOutput);
    const ledger = new FakeLedger(AI_CONFIG.budget.capMicroUsd);
    const client = new AiClient({ providers: { google: provider }, ledger, log: { warn: () => undefined }, rng: seqRng(), clock: () => new Date('2026-11-10T00:00:00Z') });
    const priceTool: ReadTool = { kind: 'read', name: 'get_price', description: 'price', input: z.object({ symbol: z.string() }), maxResultBytes: 1000, run: async () => 'FPT 100000' };
    const r = await client.generate({ task: 'chat', system: 's', messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }], tools: [priceTool], output: z.object({ summary: z.string() }), provider: 'google' });
    expect(r).toMatchObject({ ok: true, value: { summary: 'ok' }, provider: 'google' });
    expect(calls).toHaveLength(2);
  });
});

describe('google final_output stop handling', () => {
  const fo = [{ functionCall: { name: 'final_output', args: { summary: 'ok' } } }];
  test('truncated final_output -> max_tokens, no parts', async () => {
    const r = await fake(googleWith(fo, 'MAX_TOKENS')).provider.generate(req({ output: out }));
    expect(r).toMatchObject({ parts: [], stop: 'max_tokens', usage: { inputTokens: 120, outputTokens: 40 } });
  });
  test('safety with final_output -> refused with usage', async () => {
    await expect(fake(googleWith(fo, 'SAFETY')).provider.generate(req({ output: out }))).rejects.toMatchObject({ code: 'refused', usage: { inputTokens: 120 } });
  });
  test.each([['OTHER'], [null]])('finish reason %s with final_output -> malformed', async (reason) => {
    await expect(fake(googleWith(fo, reason)).provider.generate(req({ output: out }))).rejects.toMatchObject({ code: 'malformed', usage: { inputTokens: 120 } });
  });
});

describe('google missing candidatesTokenCount', () => {
  const text = [{ text: 'hi' }];
  test('derives output from total minus prompt and tool-use prompt', async () => {
    const r = await fake(googleWith(text, 'STOP', { promptTokenCount: 100, toolUsePromptTokenCount: 20, totalTokenCount: 170 })).provider.generate(req());
    expect(r.usage).toEqual({ inputTokens: 120, outputTokens: 50 });
  });
  test.each([
    ['no total', { promptTokenCount: 100 }],
    ['total below prompt', { promptTokenCount: 100, totalTokenCount: 50 }],
    ['invalid total', { promptTokenCount: 100, totalTokenCount: 1.5 }],
  ])('%s -> malformed with null usage', async (_n, meta) => {
    await expect(fake(googleWith(text, 'STOP', meta)).provider.generate(req())).rejects.toMatchObject({ code: 'malformed', usage: null });
  });
  test('no output parts keeps 0 without a total', async () => {
    const r = await fake(googleWith([], 'MAX_TOKENS', { promptTokenCount: 100 })).provider.generate(req());
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 0 });
  });
  test('no output parts with a higher total -> derived value', async () => {
    const r = await fake(googleWith([], 'MAX_TOKENS', { promptTokenCount: 100, totalTokenCount: 160 })).provider.generate(req());
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 60 });
  });
  test('null candidates behaves like missing', async () => {
    const r = await fake(googleWith(text, 'STOP', { promptTokenCount: 100, candidatesTokenCount: null, totalTokenCount: 150 })).provider.generate(req());
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    await expect(fake(googleWith(text, 'STOP', { promptTokenCount: 100, candidatesTokenCount: null })).provider.generate(req())).rejects.toMatchObject({ code: 'malformed', usage: null });
  });
  test('total higher than candidates + thoughts wins', async () => {
    const r = await fake(googleWith(text, 'STOP', { promptTokenCount: 100, candidatesTokenCount: 5, thoughtsTokenCount: 5, totalTokenCount: 130 })).provider.generate(req());
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 30 });
  });
});
