import { CHART_RANGES, DEFAULT_CHART_RANGE } from '@stoktok/core';
import type { ChartRange } from '@stoktok/core';

type SearchParams = Record<string, string | string[] | undefined>;

/** Whitelists `?range=`; anything else (missing, lower-case, unknown) falls back to the default. */
export function parseChartRange(sp: SearchParams): ChartRange {
  const raw = Array.isArray(sp.range) ? sp.range[0] : sp.range;
  return CHART_RANGES.find((r) => r === raw) ?? DEFAULT_CHART_RANGE;
}

export function chartRangeHref(symbol: string, range: ChartRange): string {
  return `/symbols/${encodeURIComponent(symbol)}?range=${range}`;
}
