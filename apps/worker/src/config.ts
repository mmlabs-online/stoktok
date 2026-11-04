import { DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS } from '@stoktok/core';

/** R5: sync tuning is configuration, not literals in code. */
export const PRICE_SOURCE_IDS = ['vci-public', 'tcbs-public'] as const;
export type PriceSourceId = (typeof PRICE_SOURCE_IDS)[number];
export const isPriceSourceId = (v: string): v is PriceSourceId => (PRICE_SOURCE_IDS as readonly string[]).includes(v);

export const FINANCIALS_SOURCE_IDS = ['vci-iq', 'tcbs-public'] as const;
export type FinancialsSourceId = (typeof FINANCIALS_SOURCE_IDS)[number];
export const isFinancialsSourceId = (v: string): v is FinancialsSourceId => (FINANCIALS_SOURCE_IDS as readonly string[]).includes(v);

export const EOD_SYNC_CONFIG = {
  /** Active end-of-day price source (ADR 0004). `--source <id>` overrides it per run. */
  priceSource: 'vci-public' as PriceSourceId,
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
  /** Backfill window when `--backfill` has no value (about 200 bars plus slack). */
  backfillDefaultTradingDays: 260,
  /** Upper bound accepted by the CLI for `--backfill <n>`. */
  backfillMaxTradingDays: 520,
  /** Trading days per source request in backfill mode (source range caps are unverified, ADR 0001/0004). */
  backfillChunkTradingDays: 60,
  /** A backfill planning more requests than this aborts before any fetch. */
  maxBackfillRequests: 500,
};
export type EodSyncConfig = typeof EOD_SYNC_CONFIG;

export const TCBS_CONFIG = {
  baseUrl: 'https://apipubaws.tcbs.com.vn',
  userAgent: 'stoktok/0.1 (personal portfolio tracker; low-volume end-of-day sync)',
  financialsUserAgent: 'stoktok/0.1 (personal portfolio tracker; low-volume daily financials check)',
};

export const VCI_CONFIG = {
  baseUrl: 'https://trading.vietcap.com.vn/api',
  chartPath: '/chart/OHLCChart/gap-chart',
  userAgent: 'stoktok/0.1 (personal portfolio tracker; low-volume end-of-day sync)',
  /** Largest countBack (calendar days) accepted per request; the real server cap is unverified (ADR 0004). */
  maxCalendarDaysPerRequest: 400,
};

/** VietCap IQ financials (ADR 0005). Public, no credentials. */
export const VCI_IQ_CONFIG = {
  baseUrl: 'https://iq.vietcap.com.vn/api/iq-insight-service/v1/company',
  userAgent: 'stoktok/0.1 (personal portfolio tracker; low-volume daily financials check)',
  /**
   * Company types with a mapping (VCI_IQ_FIELDS_BY_COMPANY_TYPE) that are enabled. NH, CK, BH were enabled after the
   * STK-042 offline cross-check (derived TTM parent NI and parent equity within 3% of marketCap/pe and marketCap/pb).
   */
  supportedCompanyTypes: ['CT', 'NH', 'CK', 'BH'] as readonly string[],
};

export const FINANCIALS_SYNC_CONFIG = {
  /** Active quarterly financials source (ADR 0005). `--source <id>` overrides it per run. */
  financialsSource: 'vci-iq' as FinancialsSourceId,
  /** Quarters kept per symbol, ending at the latest expected quarter. */
  lookbackQuarters: 12,
  /** VietCap IQ returns full history; emit only the latest N quarters (lookbackQuarters + 4 covers early publishers and the TTM window). */
  vciIqMaxQuarters: 16,
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
  /** Exact reject reason codes that are reported (`unsupportedSymbols`) but do not make the run fail. Their in-window quarters are still recorded as gaps (R4). */
  nonFailingRejectReasons: ['unsupported_company_type'] as readonly string[],
};
export type FinancialsSyncConfig = typeof FINANCIALS_SYNC_CONFIG;

export const SIGNALS_JOB_CONFIG = {
  upsertChunkSize: 500,
  /** Symbols per financials read (each symbol has up to ~12 quarters; keeps a response under the 1000-row cap). */
  financialsSymbolChunk: 50,
};

/** One-off cleanup of price gaps that only cover exchange holidays (STK-046). */
export const HOLIDAY_GAPS_CONFIG = {
  /** Rows per read page (PostgREST caps a response at 1000). */
  pageSize: 1000,
  /** Gap ids per update, to keep the request URL short. */
  resolveChunkSize: 200,
};
export type HolidayGapsConfig = typeof HOLIDAY_GAPS_CONFIG;
