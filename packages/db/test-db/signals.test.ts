import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { kyselyOf } from '../src/pg/access';
import { listLatestSignals, upsertSignals } from '../src/repos/signals';
import type { SignalInsert } from '../src/rows';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

const sig = (o: Partial<SignalInsert> = {}): SignalInsert => ({
  symbol: 'AAA',
  rule_id: 'price_vs_ma',
  horizon: 'medium',
  signal_date: '2026-11-09',
  status: 'ok',
  label: 'bullish',
  value: 42,
  data_fresh: true,
  reason_codes: [],
  inputs_snapshot: { close: 110, nested: { a: [1, 2] } },
  rule_version: 1,
  computed_at: '2026-11-09T10:00:00+00:00',
  ...o,
});
const raw = () => kyselyOf(t.pgDb).selectFrom('signals').selectAll().orderBy('id').execute();

describe('signals repo', () => {
  test('each of the 4 key columns discriminates; replace updates label (to null), value, reason_codes, inputs_snapshot, computed_at; id and created_at unchanged', async () => {
    await upsertSignals(t.pgDb, [sig()]);
    await upsertSignals(t.pgDb, [sig({ symbol: 'BBB' }), sig({ rule_id: 'other_rule' }), sig({ signal_date: '2026-11-10' })]);
    expect(await raw()).toHaveLength(4);
    const [first] = await raw();
    await upsertSignals(t.pgDb, [
      sig({ status: 'suppressed', label: null, value: null, data_fresh: false, reason_codes: ['stale_data'], inputs_snapshot: { x: 1 }, computed_at: '2026-11-09T12:00:00+00:00' }),
    ]);
    const rows = await raw();
    expect(rows).toHaveLength(4);
    const upd = rows[0]!;
    expect(upd).toMatchObject({ id: first!.id, created_at: first!.created_at, label: null, value: null, reason_codes: ['stale_data'], inputs_snapshot: { x: 1 }, computed_at: '2026-11-09T12:00:00+00:00', status: 'suppressed' });
    expect(first!.inputs_snapshot).toEqual({ close: 110, nested: { a: [1, 2] } });
  });

  test('listLatestSignals returns the newest per rule in ruleIds order, omits rules without rows', async () => {
    await upsertSignals(t.pgDb, [sig({ symbol: 'LL', rule_id: 'r_a', signal_date: '2026-11-01', value: 1 }), sig({ symbol: 'LL', rule_id: 'r_a', signal_date: '2026-11-05', value: 2 }), sig({ symbol: 'LL', rule_id: 'r_b', value: 3 })]);
    const out = await listLatestSignals(t.pgDb, 'LL', ['r_b', 'r_none', 'r_a']);
    expect(out.map((s) => [s.ruleId, s.value])).toEqual([['r_b', 3], ['r_a', 2]]);
    expect(await listLatestSignals(t.pgDb, 'LL', [])).toEqual([]);
  });

  test('a check violation → VALIDATION', async () => {
    const e = await upsertSignals(t.pgDb, [sig({ symbol: 'CV', status: 'ok', label: null })]).catch((x: unknown) => x);
    expect(e).toMatchObject({ code: 'VALIDATION' });
    expect(await upsertSignals(t.pgDb, [sig({ symbol: 'DD' }), sig({ symbol: 'DD', value: 7 })])).toBe(1);
  });
});
