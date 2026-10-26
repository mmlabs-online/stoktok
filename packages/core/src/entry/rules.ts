import { DEFAULT_MARKET_RULES } from '../settings/market-rules';

/** Market rules used by entry validation. Configuration, passed as a parameter (R5). */
export interface TradingRules {
  /** Board lot size in shares. */
  lotSize: number;
}

/** Fallback when no rules are stored; defined once in DEFAULT_MARKET_RULES (R5). */
export const DEFAULT_TRADING_RULES: TradingRules = { lotSize: DEFAULT_MARKET_RULES.lotSize };

/** Upper bound for quantity and price inputs (Postgres int4). */
export const INT32_MAX = 2_147_483_647;

/** Sanity bound per asset row (10^14 VND): keeps sums of many rows under MAX_SAFE_INTEGER. */
export const ASSET_VALUE_MAX = 100_000_000_000_000;

/** Maximum asset name length in Unicode code points. */
export const ASSET_NAME_MAX_LENGTH = 100;

/** A price below this (VND) needs an explicit confirmation: guards against typing thousands. */
export const LOW_PRICE_CONFIRM_BELOW = 1000;
