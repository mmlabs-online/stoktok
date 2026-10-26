/** Medium-term signal parameters stored in settings.rule_configs.signals.medium (R5). */

export interface ValuationRuleParams {
  enabled: boolean;
  /** Fewer valid peers in the same sector suppresses the signal. */
  minPeers: number;
  /** Ratio at least this far below the peer median is bullish (ppm of the median). */
  discountPpm: number;
  /** Ratio at least this far above the peer median is bearish (ppm of the median). */
  premiumPpm: number;
}

export interface SignalRules {
  peVsSector: ValuationRuleParams;
  pbVsSector: ValuationRuleParams;
  earningsGrowth: {
    enabled: boolean;
    /** Year-on-year comparisons looked at (latest quarters). */
    comparisons: number;
    /** The latest this many comparisons must agree for a bullish/bearish label. */
    minConsecutive: number;
    /** Year-on-year change of at least this is up/down (ppm). */
    growthThresholdPpm: number;
    /** A positive base below this share of its quarter's revenue counts as non-positive (ppm). */
    minBasePpmOfRevenue: number;
  };
  priceVsMa: {
    enabled: boolean;
    shortDays: number;
    longDays: number;
    /** Distance from the MA inside which the label is neutral (ppm). */
    neutralBandPpm: number;
  };
  freshness: {
    /** Financials rows fetched longer ago than this many days are stale. */
    financialsMaxFetchAgeDays: number;
  };
}

export const DEFAULT_SIGNAL_RULES: SignalRules = {
  peVsSector: { enabled: true, minPeers: 5, discountPpm: 200_000, premiumPpm: 200_000 },
  pbVsSector: { enabled: true, minPeers: 5, discountPpm: 200_000, premiumPpm: 200_000 },
  earningsGrowth: { enabled: true, comparisons: 4, minConsecutive: 2, growthThresholdPpm: 100_000, minBasePpmOfRevenue: 10_000 },
  priceVsMa: { enabled: true, shortDays: 50, longDays: 200, neutralBandPpm: 20_000 },
  freshness: { financialsMaxFetchAgeDays: 7 },
};

interface Bound {
  min: number;
  max: number;
}

/** Inclusive bounds, shared with the Settings screen (STK-033). */
export const SIGNAL_RULE_BOUNDS = {
  minPeers: { min: 3, max: 50 },
  ratioPpm: { min: 0, max: 1_000_000 },
  comparisons: { min: 1, max: 8 },
  maDays: { min: 5, max: 250 },
  neutralBandPpm: { min: 0, max: 200_000 },
  maxFetchAgeDays: { min: 1, max: 90 },
} as const satisfies Record<string, Bound>;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function int(v: unknown, b: Bound, fallback: number): number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= b.min && v <= b.max ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function section(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = parent[key];
  return isObject(v) ? v : {};
}

function parseValuation(raw: Record<string, unknown>, d: ValuationRuleParams): ValuationRuleParams {
  const b = SIGNAL_RULE_BOUNDS;
  return {
    enabled: bool(raw.enabled, d.enabled),
    minPeers: int(raw.minPeers, b.minPeers, d.minPeers),
    discountPpm: int(raw.discountPpm, b.ratioPpm, d.discountPpm),
    premiumPpm: int(raw.premiumPpm, b.ratioPpm, d.premiumPpm),
  };
}

/** Reads rule_configs JSON. Each invalid or missing key falls back to its default on its own; a broken pair falls back together. */
export function parseSignalRules(json: unknown): SignalRules {
  const root = isObject(json) ? json : {};
  const medium = section(section(root, 'signals'), 'medium');
  const d = DEFAULT_SIGNAL_RULES;
  const b = SIGNAL_RULE_BOUNDS;

  const g = section(medium, 'earningsGrowth');
  let comparisons = int(g.comparisons, b.comparisons, d.earningsGrowth.comparisons);
  let minConsecutive = int(g.minConsecutive, { min: 1, max: b.comparisons.max }, d.earningsGrowth.minConsecutive);
  if (minConsecutive > comparisons) {
    comparisons = d.earningsGrowth.comparisons;
    minConsecutive = d.earningsGrowth.minConsecutive;
  }

  const m = section(medium, 'priceVsMa');
  let shortDays = int(m.shortDays, b.maDays, d.priceVsMa.shortDays);
  let longDays = int(m.longDays, b.maDays, d.priceVsMa.longDays);
  if (shortDays >= longDays) {
    shortDays = d.priceVsMa.shortDays;
    longDays = d.priceVsMa.longDays;
  }

  return {
    peVsSector: parseValuation(section(medium, 'peVsSector'), d.peVsSector),
    pbVsSector: parseValuation(section(medium, 'pbVsSector'), d.pbVsSector),
    earningsGrowth: {
      enabled: bool(g.enabled, d.earningsGrowth.enabled),
      comparisons,
      minConsecutive,
      growthThresholdPpm: int(g.growthThresholdPpm, b.ratioPpm, d.earningsGrowth.growthThresholdPpm),
      minBasePpmOfRevenue: int(g.minBasePpmOfRevenue, b.ratioPpm, d.earningsGrowth.minBasePpmOfRevenue),
    },
    priceVsMa: {
      enabled: bool(m.enabled, d.priceVsMa.enabled),
      shortDays,
      longDays,
      neutralBandPpm: int(m.neutralBandPpm, b.neutralBandPpm, d.priceVsMa.neutralBandPpm),
    },
    freshness: {
      financialsMaxFetchAgeDays: int(
        section(medium, 'freshness').financialsMaxFetchAgeDays,
        b.maxFetchAgeDays,
        d.freshness.financialsMaxFetchAgeDays,
      ),
    },
  };
}
