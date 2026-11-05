/**
 * VietCap public chart endpoint, one-minute bars (ADR 0006). Every value is configuration (R5).
 * Endpoint shape, unit, `to`/`countBack` semantics and batching are UNVERIFIED until the live samples are recorded.
 */
export const VCI_INTRADAY_CONFIG = {
  /** Stored as `source` (R4). Same provider id as the EOD source. */
  sourceName: 'vci-public',
  baseUrl: 'https://trading.vietcap.com.vn/api',
  chartPath: '/chart/OHLCChart/gap-chart',
  timeFrame: 'ONE_MINUTE',
  /** UNVERIFIED: bars (not minutes) assumed; 360 covers a whole session (~270 bars) either way. */
  countBack: 360,
  /** UNVERIFIED: real server cap unknown. */
  maxSymbolsPerRequest: 50,
  /** The web request path needs a tight time budget. */
  timeoutMs: 5000,
  maxAttempts: 1,
  backoffBaseMs: 0,
  /** Seconds added to `to` so the current minute bar is included. UNVERIFIED. */
  toLeadSeconds: 60,
  userAgent: 'stoktok/0.1 (personal portfolio tracker; intraday refresh while app open, max one batched request per 30 s)',
};
