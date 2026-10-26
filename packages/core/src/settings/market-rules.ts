import type { TradingRules } from '../entry/rules';

export const EXCHANGES = ['HOSE', 'HNX', 'UPCOM'] as const;
export type Exchange = (typeof EXCHANGES)[number];

export const EXCHANGE_LABELS: Record<Exchange, string> = { HOSE: 'HOSE', HNX: 'HNX', UPCOM: 'UPCoM' };

/** Market rules stored in settings.rule_configs.market (R5). */
export interface MarketRules extends TradingRules {
  /** Daily price limit per exchange in ppm (7% = 70,000). */
  priceLimitPpm: Record<Exchange, number>;
}

/** Defaults when no value is stored (CLAUDE.md market table). Verify before go-live. */
export const DEFAULT_MARKET_RULES: MarketRules = {
  lotSize: 100,
  priceLimitPpm: { HOSE: 70000, HNX: 100000, UPCOM: 150000 },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function positiveInt(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 ? v : fallback;
}

/** Reads rule_configs JSON. Each invalid or missing key falls back to its default on its own. */
export function parseMarketRules(json: unknown): MarketRules {
  const market = isObject(json) && isObject(json.market) ? json.market : {};
  const limits = isObject(market.priceLimitPpm) ? market.priceLimitPpm : {};
  const d = DEFAULT_MARKET_RULES;
  return {
    lotSize: positiveInt(market.lotSize, d.lotSize),
    priceLimitPpm: {
      HOSE: positiveInt(limits.HOSE, d.priceLimitPpm.HOSE),
      HNX: positiveInt(limits.HNX, d.priceLimitPpm.HNX),
      UPCOM: positiveInt(limits.UPCOM, d.priceLimitPpm.UPCOM),
    },
  };
}

/** Writes the market namespace into existing rule_configs, keeping every other key (e.g. signals). */
export function mergeRuleConfigs(existing: unknown, rules: MarketRules): Record<string, unknown> {
  const base = isObject(existing) ? existing : {};
  const market = isObject(base.market) ? base.market : {};
  const limits = isObject(market.priceLimitPpm) ? market.priceLimitPpm : {};
  return {
    ...base,
    market: {
      ...market,
      lotSize: rules.lotSize,
      priceLimitPpm: { ...limits, ...rules.priceLimitPpm },
    },
  };
}
