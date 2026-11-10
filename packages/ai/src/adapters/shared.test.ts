import { describe, expect, test } from 'vitest';
import { ProviderError } from '../types';
import { mapThrown, stripJsonSchemaMeta, toUsage, unwrapOutput, wrapOutputSchema } from './shared';

describe('toUsage', () => {
  test('accepts safe non-negative integers', () => {
    expect(toUsage(0, 5)).toEqual({ inputTokens: 0, outputTokens: 5 });
  });
  test.each([NaN, -1, 1.5, '10', undefined, 2 ** 53])('rejects %s', (bad) => {
    expect(toUsage(bad, 1)).toBeNull();
    expect(toUsage(1, bad)).toBeNull();
  });
});

describe('output schema wrapping', () => {
  test('object schemas are kept, others wrapped and unwrapped', () => {
    const obj = { type: 'object', properties: {} };
    expect(wrapOutputSchema(obj)).toEqual({ schema: obj, wrapped: false });
    const arr = { type: 'array', items: { type: 'string' } };
    const w = wrapOutputSchema(arr);
    expect(w.wrapped).toBe(true);
    expect(w.schema).toMatchObject({ type: 'object', properties: { value: arr }, required: ['value'] });
    expect(unwrapOutput({ value: ['a'] }, true)).toEqual(['a']);
    expect(unwrapOutput({ a: 1 }, false)).toEqual({ a: 1 });
  });
  test('stripJsonSchemaMeta drops top-level $schema only', () => {
    expect(stripJsonSchemaMeta({ $schema: 'x', type: 'object', properties: { $schema: 1 } })).toEqual({ type: 'object', properties: { $schema: 1 } });
  });
});

describe('mapThrown', () => {
  const live = new AbortController().signal;
  test('ProviderError passes through', () => {
    const e = new ProviderError('refused', null);
    expect(mapThrown(e, live)).toBe(e);
  });
  test.each([
    [{ status: 429 }, 'rate_limited'],
    [{ status: 529 }, 'rate_limited'],
    [{ status: 500 }, 'http'],
    [{ status: 400 }, 'http'],
    [{ name: 'AbortError' }, 'timeout'],
    [{ name: 'APIConnectionTimeoutError' }, 'timeout'],
    [new Error('x'), 'http'],
    ['str', 'http'],
    [null, 'http'],
  ])('%j -> %s with null usage', (e, code) => {
    const r = mapThrown(e, live);
    expect(r.code).toBe(code);
    expect(r.usage).toBeNull();
  });
  test('aborted signal -> timeout', () => {
    const c = new AbortController();
    c.abort();
    expect(mapThrown({ status: 500 }, c.signal).code).toBe('timeout');
  });
});
