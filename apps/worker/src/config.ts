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
};
