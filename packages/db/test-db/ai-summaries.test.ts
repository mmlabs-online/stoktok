import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DataError } from '../src/errors';
import { kyselyOf } from '../src/pg/access';
import { listAiSummariesForDate, upsertAiSummary } from '../src/repos/ai-summaries';
import type { AiSummaryInsert } from '../src/rows';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

const body = (text: string) => ({ sections: [{ id: 'overview', title: 'T', sentences: [{ text, inputIds: ['p:1'] }] }] }) as unknown as AiSummaryInsert['body'];
const row = (o: Partial<AiSummaryInsert> = {}): AiSummaryInsert => ({
  scope: 'symbol',
  symbol: 'FPT',
  summary_date: '2026-11-10',
  generator: 'model',
  provider: 'anthropic',
  model: 'm1',
  usage_id: null,
  body_version: 1,
  body: body('one'),
  input_ids: ['p:1'],
  created_at: '2026-11-10T10:00:00+00:00',
  ...o,
});
const raw = (symbol: string) => kyselyOf(t.pgDb).selectFrom('ai_summaries').selectAll().where('symbol', '=', symbol).executeTakeFirstOrThrow();

describe('ai_summaries repo', () => {
  test('replace keeps id, advances created_at, replaces body (jsonb) and input_ids', async () => {
    const id1 = await upsertAiSummary(t.pgDb, row());
    const first = await raw('FPT');
    const id2 = await upsertAiSummary(t.pgDb, row({ body: body('two'), input_ids: ['p:2', 'n:3'], created_at: '2026-11-10T11:00:00+00:00' }));
    expect(id2).toBe(id1);
    const r = await raw('FPT');
    expect(r.id).toBe(first.id);
    expect(r.created_at).toBe('2026-11-10T11:00:00+00:00');
    expect(r.input_ids).toEqual(['p:2', 'n:3']);
    expect(JSON.stringify(r.body)).toContain('two');
    expect(typeof id1).toBe('number');
  });

  test("template over model clears provider, model, usage_id; model with null provider → VALIDATION; portfolio '' row sorts first; deleting ai_usage nulls usage_id", async () => {
    const usage = await kyselyOf(t.pgDb).insertInto('ai_usage').values({ provider: 'anthropic', model: 'm1', task: 'summary', status: 'reserved', reserved_micro_usd: 1 }).returning('id').executeTakeFirstOrThrow();
    await upsertAiSummary(t.pgDb, row({ symbol: 'VNM', usage_id: Number(usage.id) }));
    expect((await raw('VNM')).usage_id).toBe(usage.id);
    await upsertAiSummary(t.pgDb, row({ symbol: 'VNM', generator: 'template', provider: null, model: null, usage_id: null }));
    expect(await raw('VNM')).toMatchObject({ generator: 'template', provider: null, model: null, usage_id: null });
    const e = await upsertAiSummary(t.pgDb, row({ symbol: 'HPG', provider: null })).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DataError);
    expect(e).toMatchObject({ code: 'VALIDATION' });
    await upsertAiSummary(t.pgDb, row({ scope: 'portfolio', symbol: '' }));
    const listed = await listAiSummariesForDate(t.pgDb, '2026-11-10');
    expect(listed.map((s) => s.symbol)).toEqual(['', 'FPT', 'VNM']);
    expect(listed[0]).toMatchObject({ scope: 'portfolio', inputIds: ['p:1'] });
    await upsertAiSummary(t.pgDb, row({ symbol: 'DEL', usage_id: Number(usage.id) }));
    await kyselyOf(t.pgDb).deleteFrom('ai_usage').where('id', '=', usage.id).execute();
    expect((await raw('DEL')).usage_id).toBeNull();
    expect(await listAiSummariesForDate(t.pgDb, '2026-01-01')).toEqual([]);
  });
});
