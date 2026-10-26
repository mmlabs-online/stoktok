import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import type { SignalInsert } from '../rows';
import { upsertSignals } from './signals';

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
