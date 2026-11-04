import { PRICES_GAP_TYPE, holidayOnlyGapIds, vnDateOf } from '@stoktok/core';
import type { GapResolvedReason } from '@stoktok/core';
import type { OpenGapRecord } from '@stoktok/db';
import type { HolidayGapsConfig } from '../config';

export { PRICES_GAP_TYPE };

export interface HolidayGapsStore {
  /** Effective holidays: seeded calendar plus `settings.holidays`. */
  getHolidays(): Promise<readonly string[]>;
  /** Every open `prices_daily` gap, any symbol (including market-wide and unwatched). */
  listAllOpenGaps(): Promise<OpenGapRecord[]>;
  resolveGaps(ids: number[], resolvedAt: string, reason?: GapResolvedReason): Promise<void>;
}

export interface HolidayGapsDeps {
  store: HolidayGapsStore;
  now: Date;
  config: HolidayGapsConfig;
  log: (message: string) => void;
  dryRun: boolean;
}

export interface HolidayGapsSummary {
  ok: true;
  job: 'resolve-holiday-gaps';
  dryRun: boolean;
  resolvedAt: string;
  openGaps: number;
  holidayOnly: number;
  /** 0 on dry-run. */
  gapsResolved: number;
  gaps: { id: number; symbol: string | null; from: string; to: string }[];
}

/** Resolves (never deletes) open price gaps whose days are all non-trading. Orchestration only: the rule is in core (R1). */
export async function runResolveHolidayGaps(deps: HolidayGapsDeps): Promise<HolidayGapsSummary> {
  const { store, config, log } = deps;
  const holidays = await store.getHolidays();
  const open = await store.listAllOpenGaps();
  const ids = holidayOnlyGapIds(open, holidays);
  const picked = new Set(ids);
  const gaps = open
    .filter((g) => picked.has(g.id))
    .map((g) => ({ id: g.id, symbol: g.symbol, from: vnDateOf(new Date(g.fromTs)), to: vnDateOf(new Date(g.toTs)) }));
  for (const g of gaps) log(`holiday-only gap ${g.id} ${g.symbol ?? '(market)'} ${g.from}..${g.to}`);

  const resolvedAt = deps.now.toISOString();
  if (!deps.dryRun) {
    for (let i = 0; i < ids.length; i += config.resolveChunkSize) {
      await store.resolveGaps(ids.slice(i, i + config.resolveChunkSize), resolvedAt, 'non_trading_day');
    }
  }
  return {
    ok: true,
    job: 'resolve-holiday-gaps',
    dryRun: deps.dryRun,
    resolvedAt,
    openGaps: open.length,
    holidayOnly: ids.length,
    gapsResolved: deps.dryRun ? 0 : ids.length,
    gaps,
  };
}
