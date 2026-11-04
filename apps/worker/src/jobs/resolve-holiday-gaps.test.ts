import { SEEDED_HOLIDAY_DATES, vnDayBoundsUtc } from '@stoktok/core';
import type { GapResolvedReason } from '@stoktok/core';
import type { OpenGapRecord } from '@stoktok/db';
import { describe, expect, test } from 'vitest';
import { HOLIDAY_GAPS_CONFIG } from '../config';
import { runResolveHolidayGaps } from './resolve-holiday-gaps';

const NOW = new Date('2026-11-05T01:00:00Z');
const gap = (id: number, symbol: string | null, from: string, to: string): OpenGapRecord => ({
  id,
  symbol,
  fromTs: vnDayBoundsUtc(from).fromTs,
  toTs: vnDayBoundsUtc(to).toTs,
});

function setup(open: OpenGapRecord[], config = HOLIDAY_GAPS_CONFIG) {
  const calls: { ids: number[]; at: string; reason?: GapResolvedReason }[] = [];
  const logs: string[] = [];
  const store = {
    getHolidays: async () => [...SEEDED_HOLIDAY_DATES],
    listAllOpenGaps: async () => open,
    resolveGaps: async (ids: number[], at: string, reason?: GapResolvedReason) => void calls.push({ ids, at, ...(reason ? { reason } : {}) }),
  };
  const run = (dryRun: boolean) => runResolveHolidayGaps({ store, now: NOW, config, log: (m) => void logs.push(m), dryRun });
  return { calls, logs, run };
}

const tet = gap(1, 'VNM', '2026-02-16', '2026-02-20');
const mixed = gap(2, 'VNM', '2026-02-13', '2026-02-23');

describe('runResolveHolidayGaps', () => {
  test('dry-run writes nothing and lists the holiday-only gaps', async () => {
    const s = setup([tet, mixed]);
    const out = await s.run(true);
    expect(s.calls).toHaveLength(0);
    expect(out).toMatchObject({ ok: true, dryRun: true, openGaps: 2, holidayOnly: 1, gapsResolved: 0 });
    expect(out.gaps).toEqual([{ id: 1, symbol: 'VNM', from: '2026-02-16', to: '2026-02-20' }]);
  });
  test('real run resolves only holiday-only ids with reason non_trading_day; a gap with a trading day stays open', async () => {
    const s = setup([tet, mixed]);
    const out = await s.run(false);
    expect(s.calls).toEqual([{ ids: [1], at: NOW.toISOString(), reason: 'non_trading_day' }]);
    expect(out.gapsResolved).toBe(1);
  });
  test('includes unwatched symbols and market-wide (null symbol) gaps', async () => {
    const s = setup([gap(3, 'OLD', '2026-09-02', '2026-09-02'), gap(4, null, '2026-01-01', '2026-01-02')]);
    const out = await s.run(false);
    expect(s.calls[0]?.ids).toEqual([3, 4]);
    expect(out.gaps.map((g) => g.symbol)).toEqual(['OLD', null]);
  });
  test('ids are sent in chunks of resolveChunkSize', async () => {
    const s = setup([gap(1, 'A', '2026-09-01', '2026-09-01'), gap(2, 'B', '2026-09-01', '2026-09-01'), gap(3, 'C', '2026-09-01', '2026-09-01')], {
      ...HOLIDAY_GAPS_CONFIG,
      resolveChunkSize: 2,
    });
    await s.run(false);
    expect(s.calls.map((c) => c.ids)).toEqual([[1, 2], [3]]);
  });
  test('no open gaps -> ok, no write', async () => {
    const s = setup([]);
    const out = await s.run(false);
    expect(s.calls).toHaveLength(0);
    expect(out).toMatchObject({ ok: true, openGaps: 0, holidayOnly: 0, gapsResolved: 0, gaps: [] });
  });
});
