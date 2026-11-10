import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import type { Db } from '../client';
import { getAiMonthSpend, reserveAiUsage, settleAiUsage } from './ai-usage';

const window = { fromTs: '2026-10-31T17:00:00.000Z', toTs: '2026-11-30T17:00:00.000Z' };
const req = { provider: 'google', model: 'gemini-2.5-flash', task: 'summary', reserveMicroUsd: 600, capMicroUsd: 5_000_000, window } as const;

describe('reserveAiUsage', () => {
  test("calls rpc('ai_reserve') with provider, model, task, reserve, cap, from, to", async () => {
    const f = createFake();
    f.respond({ data: [{ usage_id: 1, granted: true, spent_micro_usd: 0 }] });
    await reserveAiUsage(f.db as unknown as Db, req);
    expect(f.methods('rpc')[0]).toEqual({
      table: 'ai_reserve',
      method: 'rpc',
      args: [
        {
          p_provider: 'google',
          p_model: 'gemini-2.5-flash',
          p_task: 'summary',
          p_reserve_micro_usd: 600,
          p_cap_micro_usd: 5_000_000,
          p_from: window.fromTs,
          p_to: window.toTs,
        },
      ],
    });
  });
  test('granted row -> {granted: true, usageId, spentMicroUsd}; refused row -> {granted: false, ...}', async () => {
    const f = createFake();
    f.respond({ data: [{ usage_id: '7', granted: true, spent_micro_usd: '1200' }] });
    f.respond({ data: [{ usage_id: 8, granted: false, spent_micro_usd: 5_000_000 }] });
    expect(await reserveAiUsage(f.db as unknown as Db, req)).toEqual({ usageId: 7, granted: true, spentMicroUsd: 1200 });
    expect(await reserveAiUsage(f.db as unknown as Db, req)).toEqual({ usageId: 8, granted: false, spentMicroUsd: 5_000_000 });
  });
  test('errors -> DataError (VALIDATION / DB_ERROR), message has no model or payload', async () => {
    const f = createFake();
    f.respond({ error: { code: '23514', message: 'gemini-2.5-flash' } });
    const err = await reserveAiUsage(f.db as unknown as Db, req).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'VALIDATION' });
    expect((err as Error).message).not.toContain('gemini');
    const g = createFake();
    g.respond({ error: { code: '42501' } });
    await expect(reserveAiUsage(g.db as unknown as Db, req)).rejects.toMatchObject({ code: 'DB_ERROR' });
  });
});

describe('settleAiUsage', () => {
  const now = new Date('2026-11-10T01:00:00Z');
  test("updates by id with eq('status','reserved') and sets settled_at; returns false when no row matched", async () => {
    const f = createFake();
    f.respond({ data: [{ id: 5 }] });
    f.respond({ data: [] });
    const s = { status: 'ok', inputTokens: 10, outputTokens: 20, costMicroUsd: 55 } as const;
    expect(await settleAiUsage(f.db as unknown as Db, 5, s, now)).toBe(true);
    expect(await settleAiUsage(f.db as unknown as Db, 5, s, now)).toBe(false);
    expect(f.methods('update')[0]?.args[0]).toEqual({
      status: 'ok',
      input_tokens: 10,
      output_tokens: 20,
      cost_micro_usd: 55,
      error_code: null,
      settled_at: '2026-11-10T01:00:00.000Z',
    });
    expect(f.methods('eq').map((c) => c.args)).toContainEqual(['id', 5]);
    expect(f.methods('eq').map((c) => c.args)).toContainEqual(['status', 'reserved']);
  });
  test('settle with costMicroUsd null keeps the reservation counted', async () => {
    const f = createFake();
    f.respond({ data: [{ id: 5 }] });
    await settleAiUsage(f.db as unknown as Db, 5, { status: 'provider_error', inputTokens: 0, outputTokens: 0, costMicroUsd: null, errorCode: 'timeout' }, now);
    expect(f.methods('update')[0]?.args[0]).toMatchObject({ status: 'provider_error', cost_micro_usd: null, error_code: 'timeout' });
  });
  test('error -> DataError', async () => {
    const f = createFake();
    f.respond({ error: { code: '42501' } });
    await expect(settleAiUsage(f.db as unknown as Db, 5, { status: 'ok', inputTokens: 0, outputTokens: 0, costMicroUsd: 0 }, now)).rejects.toMatchObject({ code: 'DB_ERROR' });
  });
});

describe('getAiMonthSpend', () => {
  test('maps an int8 string to a safe integer', async () => {
    const f = createFake();
    f.respond({ data: '4000000' });
    expect(await getAiMonthSpend(f.db as unknown as Db, window)).toBe(4_000_000);
    expect(f.methods('rpc')[0]).toMatchObject({ table: 'ai_month_spend', args: [{ p_from: window.fromTs, p_to: window.toTs }] });
  });
  test('error -> DataError', async () => {
    const f = createFake();
    f.respond({ error: { code: '42501' } });
    await expect(getAiMonthSpend(f.db as unknown as Db, window)).rejects.toMatchObject({ code: 'DB_ERROR' });
  });
});
