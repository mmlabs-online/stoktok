import { DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS } from '@stoktok/core';

/** R5: sync tuning is configuration, not literals in code. */
export const EOD_SYNC_CONFIG = {
  /** Trading days fetched per symbol, ending at the target date. */
  lookbackTradingDays: 20,
  /** Pause between symbols (low request volume). */
  requestDelayMs: 1000,
  timeoutMs: 15_000,
  maxAttempts: 3,
  backoffBaseMs: 1000,
  /** Stop the run after this many symbols fail in a row (source is down or blocking). */
  maxConsecutiveFailures: 5,
  upsertChunkSize: 500,
};
export type EodSyncConfig = typeof EOD_SYNC_CONFIG;

export const TCBS_CONFIG = {
  baseUrl: 'https://apipubaws.tcbs.com.vn',
  userAgent: 'stoktok/0.1 (personal portfolio tracker; low-volume end-of-day sync)',
  financialsUserAgent: 'stoktok/0.1 (personal portfolio tracker; low-volume daily financials check)',
};

export const FINANCIALS_SYNC_CONFIG = {
  /** Quarters kept per symbol, ending at the latest expected quarter. */
  lookbackQuarters: 12,
  /** Days after quarter end by which the report is expected (VN quarterly-report deadline, 30/45 days). */
  publishLagDays: DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS,
  /** Pause between requests and between symbols (low request volume). */
  requestDelayMs: 1000,
  timeoutMs: 15_000,
  maxAttempts: 3,
  backoffBaseMs: 1000,
  /** Stop the run after this many symbols fail in a row (source is down or blocking). */
  maxConsecutiveFailures: 5,
  upsertChunkSize: 500,
  /** A response with more quarters than this is rejected as malformed. */
  maxPeriodsPerResponse: 200,
};
export type FinancialsSyncConfig = typeof FINANCIALS_SYNC_CONFIG;

export const SIGNALS_JOB_CONFIG = {
  upsertChunkSize: 500,
  /** Symbols per financials read (each symbol has up to ~12 quarters; keeps a response under the 1000-row cap). */
  financialsSymbolChunk: 50,
};
