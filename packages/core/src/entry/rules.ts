/** Market rules used by entry validation. Configuration, passed as a parameter (R5). */
export interface TradingRules {
  /** Board lot size in shares. */
  lotSize: number;
}

/** Default until settings.rule_configs is typed (STK-010). Verify before go-live. */
export const DEFAULT_TRADING_RULES: TradingRules = { lotSize: 100 };

/** Upper bound for quantity and price inputs (Postgres int4). */
export const INT32_MAX = 2_147_483_647;

/** A price below this (VND) needs an explicit confirmation: guards against typing thousands. */
export const LOW_PRICE_CONFIRM_BELOW = 1000;
