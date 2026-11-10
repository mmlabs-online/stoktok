import { afterEach, describe, expect, test, vi } from 'vitest';
import { budgetStatus } from '@stoktok/core';
import { readAiBudget } from './ai-budget';

vi.mock('server-only', () => ({}));

afterEach(() => vi.restoreAllMocks());

describe('readAiBudget', () => {
  test('ok: returns { ok: true, status }', async () => {
    const status = budgetStatus(1_000_000);
    expect(await readAiBudget(async () => ({ getAiBudgetStatus: async () => status }))).toEqual({ ok: true, status });
  });
  test('load failure (module throws MODULE_NOT_FOUND) -> { ok: false }', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const load = () => Promise.reject(Object.assign(new Error('Cannot find module secret-path'), { code: 'MODULE_NOT_FOUND' }));
    expect(await readAiBudget(load)).toEqual({ ok: false });
    expect(warn.mock.calls[0]?.[0]).toBe('{"event":"ai_budget_read_failed","code":"module_not_found"}');
  });
  test('read failure (DataError 22023 / DB_ERROR) -> { ok: false }, and the warn log has a code only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = Object.assign(new Error('ai_usage.month_spend: boom [22023]'), { code: 'DB_ERROR', pgCode: '22023' });
    const res = await readAiBudget(async () => ({ getAiBudgetStatus: () => Promise.reject(err) }));
    expect(res).toEqual({ ok: false });
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toBe('{"event":"ai_budget_read_failed","code":"read_failed"}');
    expect(logged).not.toContain('22023');
  });
});
