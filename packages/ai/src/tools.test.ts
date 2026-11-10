import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { assertReadTools, checkToolCall, toolDefs } from './tools';
import type { ReadTool } from './types';

const tool = (over: Partial<ReadTool> = {}): ReadTool => ({
  kind: 'read',
  name: 'get_price',
  description: 'price',
  input: z.object({ symbol: z.string() }),
  maxResultBytes: 100,
  run: async () => 'ok',
  ...over,
});

describe('assertReadTools', () => {
  test('valid list passes', () => {
    expect(() => assertReadTools([tool(), tool({ name: 'other' })])).not.toThrow();
  });
  test.each([
    ['non-read tool', [tool({ kind: 'write' as never })]],
    ['duplicate names', [tool(), tool()]],
    ['bad maxResultBytes', [tool({ maxResultBytes: 0 })]],
    ['fractional maxResultBytes', [tool({ maxResultBytes: 1.5 })]],
    ['reserved name final_output', [tool({ name: 'final_output' })]],
    ['bad name', [tool({ name: 'a b' })]],
  ])('%s throws', (_n, tools) => {
    expect(() => assertReadTools(tools)).toThrow(TypeError);
  });
});

describe('checkToolCall', () => {
  test('unknown name -> tool_not_allowed', () => {
    expect(checkToolCall({ name: 'nope', input: {} }, [tool()])).toEqual({ ok: false, code: 'tool_not_allowed' });
  });
  test('schema failure -> invalid_tool_input', () => {
    expect(checkToolCall({ name: 'get_price', input: { symbol: 1 } }, [tool()])).toEqual({ ok: false, code: 'invalid_tool_input' });
  });
  test('valid -> parsed input', () => {
    const r = checkToolCall({ name: 'get_price', input: { symbol: 'FPT', extra: 1 } }, [tool()]);
    expect(r.ok && r.input).toEqual({ symbol: 'FPT' });
  });
  test('toolDefs carries a JSON schema', () => {
    expect(toolDefs([tool()])[0]).toMatchObject({ name: 'get_price', inputSchema: { type: 'object' } });
  });
});
