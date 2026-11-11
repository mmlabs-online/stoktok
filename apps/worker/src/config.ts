import { DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS } from '@stoktok/core';
import type { NewsCredibility } from '@stoktok/core';

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

/** Income and balance-sheet lines (STK-061, ADR 0007). Shares the pacing and publish rules of the quarterly financials sync. */
export const FINANCIAL_STATEMENTS_SYNC_CONFIG = {
  timeoutMs: FINANCIALS_SYNC_CONFIG.timeoutMs,
  maxAttempts: FINANCIALS_SYNC_CONFIG.maxAttempts,
  backoffBaseMs: FINANCIALS_SYNC_CONFIG.backoffBaseMs,
  requestDelayMs: FINANCIALS_SYNC_CONFIG.requestDelayMs,
  maxConsecutiveFailures: FINANCIALS_SYNC_CONFIG.maxConsecutiveFailures,
  upsertChunkSize: FINANCIALS_SYNC_CONFIG.upsertChunkSize,
  maxPeriodsPerResponse: FINANCIALS_SYNC_CONFIG.maxPeriodsPerResponse,
  nonFailingRejectReasons: FINANCIALS_SYNC_CONFIG.nonFailingRejectReasons,
  publishLagDays: FINANCIALS_SYNC_CONFIG.publishLagDays,
  lookbackQuarters: FINANCIALS_SYNC_CONFIG.lookbackQuarters,
  /** Latest quarters emitted per symbol (older history is dropped silently). */
  maxQuarters: 16,
  /** Years kept per symbol, ending at the latest expected year. */
  lookbackYears: 5,
  /** Latest years emitted per symbol. */
  maxYears: 6,
  /** Days after year end by which the audited annual report is expected (90-day deadline plus slack). */
  annualPublishLagDays: 120,
  /** Symbols per stored-lines read. 4 symbols x 16 quarters x 12 lines = 768 rows, under the PostgREST 1000-row cap. */
  linesSymbolChunk: 4,
};
export type FinancialStatementsSyncConfig = typeof FINANCIAL_STATEMENTS_SYNC_CONFIG;

export const SIGNALS_JOB_CONFIG = {
  upsertChunkSize: 500,
  /** Symbols per financials read (each symbol has up to ~12 quarters; keeps a response under the 1000-row cap). */
  financialsSymbolChunk: 50,
};

/** One-off cleanup of price gaps that only cover exchange holidays (STK-046). */
export const HOLIDAY_GAPS_CONFIG = {
  /** Gap ids per update, to keep the request URL short. */
  resolveChunkSize: 200,
};
export type HolidayGapsConfig = typeof HOLIDAY_GAPS_CONFIG;

export const NEWS_SOURCE_IDS = ['cafef', 'vietstock', 'vnexpress'] as const;
export type NewsSourceId = (typeof NEWS_SOURCE_IDS)[number];
export const isNewsSourceId = (v: string): v is NewsSourceId => (NEWS_SOURCE_IDS as readonly string[]).includes(v);

export interface NewsSourceConfig {
  id: NewsSourceId;
  /** Display name stored in `news.source`. */
  name: string;
  enabled: boolean;
  credibility: NewsCredibility;
  feedUrls: readonly string[];
  /** Hosts an article link may point to (a subdomain is accepted). */
  linkHosts: readonly string[];
  upgradeHttps: boolean;
  /** Pause between two feed requests to this source. */
  minIntervalMs: number;
}

/**
 * News RSS sync (STK-062, F5). Feeds, limits and sources are configuration (R5); set `enabled: false` or edit
 * `feedUrls` to stop reading a source. robots.txt and terms notes are in apps/worker/README.md.
 */
export const NEWS_SYNC_CONFIG = {
  sources: [
    {
      id: 'cafef',
      name: 'CafeF',
      enabled: true,
      credibility: 'established_outlet',
      feedUrls: ['https://cafef.vn/thi-truong-chung-khoan.rss', 'https://cafef.vn/doanh-nghiep.rss'],
      linkHosts: ['cafef.vn'],
      upgradeHttps: true,
      minIntervalMs: 3000,
    },
    {
      id: 'vietstock',
      name: 'Vietstock',
      enabled: true,
      credibility: 'established_outlet',
      feedUrls: [
        'https://vietstock.vn/830/chung-khoan/co-phieu.rss',
        'https://vietstock.vn/739/chung-khoan/giao-dich-noi-bo.rss',
        'https://vietstock.vn/741/chung-khoan/niem-yet.rss',
        'https://vietstock.vn/738/doanh-nghiep/co-tuc.rss',
        'https://vietstock.vn/737/doanh-nghiep/hoat-dong-kinh-doanh.rss',
        'https://vietstock.vn/761/kinh-te/vi-mo.rss',
      ],
      linkHosts: ['vietstock.vn'],
      upgradeHttps: true,
      minIntervalMs: 3000,
    },
    {
      id: 'vnexpress',
      name: 'VnExpress',
      enabled: true,
      credibility: 'established_outlet',
      feedUrls: ['https://vnexpress.net/rss/kinh-doanh.rss'],
      linkHosts: ['vnexpress.net'],
      upgradeHttps: true,
      minIntervalMs: 3000,
    },
  ] as readonly NewsSourceConfig[],
  timeoutMs: 15_000,
  maxAttempts: 2,
  backoffBaseMs: 2000,
  maxBodyBytes: 2 * 1024 * 1024,
  /** A source stops after this many feeds fail in a row; the others still run. */
  maxConsecutiveFeedFailures: 2,
  maxItemsPerFeed: 100,
  maxTitleChars: 500,
  /** The database backstop is 10000. */
  maxExcerptChars: 2000,
  /** Matches the database check: published_at <= fetched_at + 1 day. */
  maxFutureMs: 86_400_000,
  /** A new gap covers this long before the failed run (the hourly interval). */
  gapLookbackMs: 3_600_000,
  /** Rows per insert statement. */
  insertChunkSize: 200,
  userAgent: 'stoktok/0.1 (personal portfolio tracker; hourly RSS check)',
  accept: 'application/rss+xml, application/xml',
};
export type NewsSyncConfig = typeof NEWS_SYNC_CONFIG;
