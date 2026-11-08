/** `data_gaps.data_type` for news; one market-wide (symbol null) gap per source id (R4). */
export const NEWS_GAP_TYPE = 'news';

export interface OpenNewsGap {
  id: number;
}

export interface NewsGapPlan {
  insert?: { from: string; to: string };
  extendIds: number[];
  resolveIds: number[];
}

/**
 * One source, one run. Failure with no open gap opens one covering the last `gapLookbackMs`; failure with open gaps
 * extends the newest, so an hourly outage is one row. Success resolves every open gap of the source.
 */
export function planNewsGap(input: { failed: boolean; openGaps: readonly OpenNewsGap[]; now: Date; gapLookbackMs: number }): NewsGapPlan {
  const { failed, openGaps, now, gapLookbackMs } = input;
  if (!failed) return { extendIds: [], resolveIds: openGaps.map((g) => g.id) };
  if (openGaps.length === 0) {
    return { insert: { from: new Date(now.getTime() - gapLookbackMs).toISOString(), to: now.toISOString() }, extendIds: [], resolveIds: [] };
  }
  return { extendIds: [Math.max(...openGaps.map((g) => g.id))], resolveIds: [] };
}
