import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import type { AiSummaryBody } from '@stoktok/core';
import type { Db } from '../client';
import type { AiSummaryInsert } from '../rows';
import { listAiSummariesForDate, upsertAiSummary } from './ai-summaries';

const body: AiSummaryBody = { version: 1, strippedCount: 0, sections: [{ topic: 'price', missing: false, sentences: [{ text: 'Giá đóng cửa.', inputIds: ['px:VNM:2026-11-10'] }] }] };
const row: AiSummaryInsert = {
  scope: 'symbol',
  symbol: 'VNM',
  summary_date: '2026-11-10',
  generator: 'template',
  provider: null,
  model: null,
  usage_id: null,
  body_version: 1,
  body,
  input_ids: ['px:VNM:2026-11-10'],
  created_at: '2026-11-10T11:00:00.000Z',
};

describe('upsertAiSummary', () => {
  test('upserts on scope,symbol,summary_date and sends every column (usage_id/provider/model null for template rows, created_at set)', async () => {
    const f = createFake();
    f.respond({ data: [{ id: 3 }] });
    await upsertAiSummary(f.db as unknown as Db, row);
    const up = f.methods('upsert')[0];
    expect(up?.table).toBe('ai_summaries');
    expect(up?.args).toEqual([row, { onConflict: 'scope,symbol,summary_date' }]);
    expect(Object.keys(up?.args[0] as object).sort()).toEqual(
      ['body', 'body_version', 'created_at', 'generator', 'input_ids', 'model', 'provider', 'scope', 'summary_date', 'symbol', 'usage_id'],
    );
  });
  test('returns the id; DB error is mapped to DataError', async () => {
    const f = createFake();
    f.respond({ data: [{ id: '42' }] });
    f.respond({ error: { code: '23514' } });
    f.respond({ error: { code: '42501' } });
    expect(await upsertAiSummary(f.db as unknown as Db, row)).toBe(42);
    await expect(upsertAiSummary(f.db as unknown as Db, row)).rejects.toMatchObject({ name: 'DataError', code: 'VALIDATION' });
    await expect(upsertAiSummary(f.db as unknown as Db, row)).rejects.toMatchObject({ name: 'DataError', code: 'DB_ERROR' });
  });
});

describe('listAiSummariesForDate', () => {
  test('selects explicit columns, maps bigint ids, returns body null for an invalid stored body', async () => {
    const f = createFake();
    const base = { scope: 'symbol', symbol: 'VNM', summary_date: '2026-11-10', generator: 'model', provider: 'google', model: 'm', body_version: 1, input_ids: ['px:VNM:2026-11-10'], created_at: 't' };
    f.respond({
      data: [
        { ...base, id: '7', usage_id: '9', body },
        { ...base, id: 8, symbol: 'FPT', usage_id: null, body: { version: 9 } },
        { ...base, id: 10, usage_id: null, input_ids: [] },
        { ...base, id: 11, symbol: 'FPT', usage_id: null, input_ids: ['px:VNM:2026-11-10'] },
      ],
    });
    const out = await listAiSummariesForDate(f.db as unknown as Db, '2026-11-10');
    const sel = f.methods('select')[0]?.args[0] as string;
    expect(sel).not.toContain('*');
    expect(sel.split(',')).toContain('body');
    expect(f.methods('eq')[0]?.args).toEqual(['summary_date', '2026-11-10']);
    expect(out[0]).toMatchObject({ id: 7, usageId: 9, summaryDate: '2026-11-10', body, inputIds: ['px:VNM:2026-11-10'] });
    expect(out[1]).toMatchObject({ id: 8, usageId: null, body: null });
    expect(out[2]).toMatchObject({ id: 10, body: null }); // cited id not in input_ids
    expect(out[3]).toMatchObject({ id: 11, body: null }); // VNM id in an FPT row
  });
});
