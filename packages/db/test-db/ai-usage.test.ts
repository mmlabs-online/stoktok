import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { DataError } from '../src/errors';
import { kyselyOf } from '../src/pg/access';
import { createPgDb, DATABASE_URL_ENV, type PgDb } from '../src/pg/client';
import { aiUsageLedger, getAiMonthSpend, reserveAiUsage, settleAiUsage } from '../src/repos/ai-usage';
import type { AiReserveRequest } from '../src/repos/ai-usage';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});
beforeEach(async () => {
  await kyselyOf(t.pgDb).deleteFrom('ai_usage').execute();
});

const DAY = 86_400_000;
const window = () => ({ fromTs: new Date(Date.now() - DAY).toISOString(), toTs: new Date(Date.now() + DAY).toISOString() });
const req = (o: Partial<AiReserveRequest> = {}): AiReserveRequest => ({
  provider: 'anthropic',
  model: 'claude-test',
  task: 'summary',
  reserveMicroUsd: 100,
  capMicroUsd: 300,
  window: window(),
  ...o,
});
const err = async (p: Promise<unknown>) => {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(DataError);
  return e as DataError;
};

describe('ai_usage repo', () => {
  test('grant and refusal rows; refused cost 0 does not raise spent', async () => {
    const a = await reserveAiUsage(t.pgDb, req({ reserveMicroUsd: 200 }));
    expect(a).toMatchObject({ granted: true, spentMicroUsd: 0 });
    expect(typeof a.usageId).toBe('number');
    const b = await reserveAiUsage(t.pgDb, req({ reserveMicroUsd: 200 }));
    expect(b).toMatchObject({ granted: false, spentMicroUsd: 200 });
    expect(await getAiMonthSpend(t.pgDb, window())).toBe(200);
    const rows = await kyselyOf(t.pgDb).selectFrom('ai_usage').select(['status', 'cost_micro_usd']).orderBy('id').execute();
    expect(rows).toEqual([{ status: 'reserved', cost_micro_usd: null }, { status: 'refused', cost_micro_usd: '0' }]);
  });

  test('argument validation (zero reserve, window without now(), p_from >= p_to, null) → DataError DB_ERROR pgCode 22023', async () => {
    const w = window();
    const bad: Partial<AiReserveRequest>[] = [
      { reserveMicroUsd: 0 },
      { window: { fromTs: new Date(Date.now() + DAY).toISOString(), toTs: new Date(Date.now() + 2 * DAY).toISOString() } },
      { window: { fromTs: w.toTs, toTs: w.fromTs } },
      { capMicroUsd: null as unknown as number },
    ];
    for (const o of bad) {
      const e = await err(reserveAiUsage(t.pgDb, req(o)));
      expect(e).toMatchObject({ code: 'DB_ERROR', pgCode: '22023' });
      expect(e.message).not.toContain('claude-test');
    }
  });

  test('ai_month_spend: settled cost counted, unsettled at reserve, outside window excluded, empty → 0', async () => {
    expect(await getAiMonthSpend(t.pgDb, window())).toBe(0);
    const a = await reserveAiUsage(t.pgDb, req());
    const b = await reserveAiUsage(t.pgDb, req());
    expect(await getAiMonthSpend(t.pgDb, window())).toBe(200);
    await settleAiUsage(t.pgDb, a.usageId, { status: 'ok', inputTokens: 10, outputTokens: 5, costMicroUsd: 30 }, new Date());
    expect(await getAiMonthSpend(t.pgDb, window())).toBe(130);
    await kyselyOf(t.pgDb).updateTable('ai_usage').set({ created_at: new Date(Date.now() - 10 * DAY).toISOString() }).where('id', '=', String(b.usageId)).execute();
    expect(await getAiMonthSpend(t.pgDb, window())).toBe(30);
  });

  test('settleAiUsage only from reserved; second settle false; ok without cost → VALIDATION; bad errorCode → VALIDATION', async () => {
    const a = await reserveAiUsage(t.pgDb, req());
    expect(await settleAiUsage(t.pgDb, a.usageId, { status: 'ok', inputTokens: 1, outputTokens: 2, costMicroUsd: 5 }, new Date())).toBe(true);
    expect(await settleAiUsage(t.pgDb, a.usageId, { status: 'ok', inputTokens: 1, outputTokens: 2, costMicroUsd: 9 }, new Date())).toBe(false);
    const b = await reserveAiUsage(t.pgDb, req());
    expect((await err(settleAiUsage(t.pgDb, b.usageId, { status: 'ok', inputTokens: 1, outputTokens: 2, costMicroUsd: null }, new Date()))).code).toBe('VALIDATION');
    expect((await err(settleAiUsage(t.pgDb, b.usageId, { status: 'provider_error', inputTokens: 0, outputTokens: 0, costMicroUsd: null, errorCode: 'Bad Code!' }, new Date()))).code).toBe('VALIDATION');
    expect(await settleAiUsage(t.pgDb, b.usageId, { status: 'provider_error', inputTokens: 0, outputTokens: 0, costMicroUsd: null, errorCode: 'timeout' }, new Date())).toBe(true);
    expect(await settleAiUsage(t.pgDb, 987654321, { status: 'ok', inputTokens: 0, outputTokens: 0, costMicroUsd: 0 }, new Date())).toBe(false);
  });

  test('aiUsageLedger binds the three functions to the handle', async () => {
    const ledger = aiUsageLedger(t.pgDb);
    const r = await ledger.reserve(req());
    expect(r.granted).toBe(true);
    expect(await ledger.monthSpend(window())).toBe(100);
    expect(await ledger.settle(r.usageId, { status: 'ok', inputTokens: 0, outputTokens: 0, costMicroUsd: 1 }, new Date())).toBe(true);
  });

  test('ai_reserve concurrency: 12 parallel reserves of 100 under cap 300 → exactly 3 granted seeing {0,100,200}, 9 refused seeing 300, 12 unique ids, month spend 300 (3 rounds)', async () => {
    const wide: PgDb = createPgDb({ [DATABASE_URL_ENV]: t.url }, 'web', { max: 12 });
    try {
      for (let round = 0; round < 3; round++) {
        await kyselyOf(t.pgDb).deleteFrom('ai_usage').execute();
        const w = window();
        const out = await Promise.all(Array.from({ length: 12 }, () => reserveAiUsage(wide, req({ window: w }))));
        const granted = out.filter((r) => r.granted);
        const refused = out.filter((r) => !r.granted);
        expect(granted).toHaveLength(3);
        expect(granted.map((r) => r.spentMicroUsd).sort((a, b) => a - b)).toEqual([0, 100, 200]);
        expect(refused).toHaveLength(9);
        expect(refused.every((r) => r.spentMicroUsd === 300)).toBe(true);
        expect(new Set(out.map((r) => r.usageId)).size).toBe(12);
        expect(await getAiMonthSpend(t.pgDb, w)).toBe(300);
      }
    } finally {
      await wide.end();
    }
  });
});
