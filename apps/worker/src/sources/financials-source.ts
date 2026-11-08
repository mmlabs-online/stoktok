import type { NormalizedStatementLines, QuarterlyFinancials, StatementLine } from '@stoktok/core';

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

export interface StatementPeriod {
  periodKind: 'quarter' | 'year';
  /** 'YYYYQn' for quarters, 'YYYY' for years. */
  period: string;
  /** Valid lines only, integer VND (R2). */
  values: NormalizedStatementLines['values'];
  /** Mapped lines with no usable value (R4: no row, a gap). Not-applicable lines are in neither list. */
  missing: StatementLine[];
}

export interface StatementsResult {
  /** The source's company type code, or null when unknown. */
  companyType: string | null;
  /** Lines mapped for this company type; empty when the type is unsupported. */
  expectedLines: StatementLine[];
  /** Ascending by period within each kind. */
  periods: StatementPeriod[];
  rejected: RejectedPeriod[];
}

/** Income-statement and balance-sheet lines, quarterly and annual, as published. Sibling of `FinancialsSource` (spec §4.3). */
export interface FinancialStatementsSource {
  /** Stored as `source` on every row (R4). */
  readonly name: string;
  fetchStatements(symbol: string): Promise<StatementsResult>;
}

/** Quarterly EPS, BVPS, revenue and net income plus a sector label. Implementations are swappable (spec §4.3). */
export interface FinancialsSource {
  /** Stored as `source` on every row (R4). */
  readonly name: string;
  fetchQuarterly(symbol: string): Promise<QuarterlyResult>;
  /** Sector label as published, or null when unknown. */
  fetchSector(symbol: string): Promise<string | null>;
}
