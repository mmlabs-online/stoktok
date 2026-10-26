import type { QuarterlyFinancials } from '@stoktok/core';

export interface RejectedPeriod {
  /** Present when year and quarter parsed, so the caller knows the quarter exists. */
  period?: string;
  reason: string;
}

export interface QuarterlyResult {
  /** Ascending by period; integer VND (R2). */
  periods: QuarterlyFinancials[];
  rejected: RejectedPeriod[];
}

/** Quarterly EPS, BVPS, revenue and net income plus a sector label. Implementations are swappable (spec §4.3). */
export interface FinancialsSource {
  /** Stored as `source` on every row (R4). */
  readonly name: string;
  fetchQuarterly(symbol: string): Promise<QuarterlyResult>;
  /** Sector label as published, or null when unknown. */
  fetchSector(symbol: string): Promise<string | null>;
}
