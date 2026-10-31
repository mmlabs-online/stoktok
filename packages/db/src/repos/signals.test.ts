import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import type { SignalInsert } from '../rows';
import { listLatestSignals, upsertSignals } from './signals';

const row = (symbol: string, ruleId: string, value: number | null = 1, date = '2026-10-26'): SignalInsert => ({
  symbol,
  rule_id: ruleId,
  horizon: 'medium',
  signal_date: date,
  status: value === null ? 'suppressed' : 'ok',
  label: value === null ? null : 'neutral',
  value,
  data_fresh: value !== null,
  reason_codes: value === null ? ['price_stale'] : [],
  inputs_snapshot: {},
  rule_version: 1,
  computed_at: '2026-10-26T12:00:00.000Z',
});

describe('upsertSignals', () => {
  test('dedupes (later wins), 3 chunks for 5 rows at chunkSize 2, onConflict string, no select', async () => {
    const f = createFake();
    for (let i = 0; i < 3; i++) f.respond({});
    const rows = [row('A', 'r1'), row('A', 'r1', 2), row('A', 'r2'), row('B', 'r1'), row('B', 'r2'), row('C', 'r1')];
    expect(await upsertSignals(f.db, rows, { chunkSize: 2 })).toBe(5);
    const ups = f.methods('upsert');
    expect(ups).toHaveLength(3);
    expect(ups[0]?.args[1]).toEqual({ onConflict: 'symbol,rule_id,horizon,signal_date' });
    expect((ups[0]?.args[0] as SignalInsert[])[0]?.value).toBe(2);
    expect(f.methods('select')).toHaveLength(0);
  });
  test('same rule on another date is a different key', async () => {
    const f = createFake();
    f.respond({});
    expect(await upsertSignals(f.db, [row('A', 'r1', 1, '2026-10-23'), row('A', 'r1', 1, '2026-10-26')])).toBe(2);
  });
  test('empty -> no call', async () => {
    const f = createFake();
    expect(await upsertSignals(f.db, [])).toBe(0);
    expect(f.calls).toHaveLength(0);
  });
  test('23514 -> DataError VALIDATION', async () => {
    const f = createFake();
    f.respond({ error: { code: '23514' } });
    await expect(upsertSignals(f.db, [row('A', 'r1')])).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

const stored = (ruleId: string, over: Record<string, unknown> = {}) => ({
  symbol: 'FPT',
  rule_id: ruleId,
  signal_date: '2026-10-26',
  status: 'ok',
  label: 'bullish',
  value: 123,
  reason_codes: [],
  inputs_snapshot: { refs: [] },
  rule_version: 1,
  computed_at: '2026-10-26T12:00:00.000Z',
  ...over,
});

describe('listLatestSignals', () => {
  test('one query per rule id: eq symbol, horizon medium, rule_id, order signal_date desc, limit 1', async () => {
    const f = createFake();
    f.respond({ data: stored('pe_vs_sector') });
    f.respond({ data: stored('pb_vs_sector') });
    const out = await listLatestSignals(f.db, 'FPT', ['pe_vs_sector', 'pb_vs_sector']);
    expect(f.methods('select')).toHaveLength(2);
    expect(f.methods('eq').map((c) => c.args)).toEqual([
      ['symbol', 'FPT'],
      ['horizon', 'medium'],
      ['rule_id', 'pe_vs_sector'],
      ['symbol', 'FPT'],
      ['horizon', 'medium'],
      ['rule_id', 'pb_vs_sector'],
    ]);
    expect(f.methods('order')[0]?.args).toEqual(['signal_date', { ascending: false }]);
    expect(f.methods('limit')[0]?.args).toEqual([1]);
    expect(out.map((r) => r.ruleId)).toEqual(['pe_vs_sector', 'pb_vs_sector']);
    expect(out[0]).toMatchObject({ symbol: 'FPT', signalDate: '2026-10-26', status: 'ok', label: 'bullish', value: 123, ruleVersion: 1 });
  });
  test('a rule without a row is omitted; result keeps ruleIds order', async () => {
    const f = createFake();
    f.respond({ data: null });
    f.respond({ data: stored('earnings_growth_trend') });
    const out = await listLatestSignals(f.db, 'FPT', ['pe_vs_sector', 'earnings_growth_trend']);
    expect(out.map((r) => r.ruleId)).toEqual(['earnings_growth_trend']);
  });
  test('empty ruleIds -> [] and no call', async () => {
    const f = createFake();
    expect(await listLatestSignals(f.db, 'FPT', [])).toEqual([]);
    expect(f.calls).toHaveLength(0);
  });
  test('value as string "123" maps to 123; an unsafe integer -> MAPPING', async () => {
    const f = createFake();
    f.respond({ data: stored('r', { value: '123', rule_version: '1' }) });
    expect((await listLatestSignals(f.db, 'FPT', ['r']))[0]).toMatchObject({ value: 123, ruleVersion: 1 });
    const g = createFake();
    g.respond({ data: stored('r', { value: '99999999999999999999' }) });
    await expect(listLatestSignals(g.db, 'FPT', ['r'])).rejects.toMatchObject({ code: 'MAPPING' });
    const h = createFake();
    h.respond({ data: stored('r', { value: 1.5 }) });
    await expect(listLatestSignals(h.db, 'FPT', ['r'])).rejects.toMatchObject({ code: 'MAPPING' });
  });
  test('invalid status, label or signal_date -> MAPPING; unknown reason code is kept as is', async () => {
    for (const bad of [{ status: 'weird' }, { label: 'buy' }, { signal_date: '26/10/2026' }]) {
      const f = createFake();
      f.respond({ data: stored('r', bad) });
      await expect(listLatestSignals(f.db, 'FPT', ['r'])).rejects.toMatchObject({ code: 'MAPPING' });
    }
    const f = createFake();
    f.respond({ data: stored('r', { status: 'suppressed', label: null, value: null, reason_codes: ['price_stale', 'brand_new_code'] }) });
    expect((await listLatestSignals(f.db, 'FPT', ['r']))[0]).toMatchObject({ label: null, value: null, reasonCodes: ['price_stale', 'brand_new_code'] });
  });
  test('inputs_snapshot is passed through untouched', async () => {
    const f = createFake();
    const snapshot = { refs: [{ ref: 'x', odd: [1, 2] }], anything: true };
    f.respond({ data: stored('r', { inputs_snapshot: snapshot }) });
    expect((await listLatestSignals(f.db, 'FPT', ['r']))[0]?.inputs).toBe(snapshot);
  });
  test('DB error -> DataError', async () => {
    const f = createFake();
    f.respond({ error: { code: '42501' } });
    await expect(listLatestSignals(f.db, 'FPT', ['r'])).rejects.toMatchObject({ code: 'DB_ERROR' });
  });
});
