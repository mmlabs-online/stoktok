export function describeCore(): string {
  return '@stoktok/core';
}

export {
  addTradingDays,
  isTradingDay,
  isValidDate,
  previousTradingDay,
  subtractTradingDays,
  tradingDaysBetween,
  vnDateOf,
  vnDayBoundsUtc,
  vnMinutesOf,
} from './calendar';
export { planBackfillChunks } from './market/backfill';
export { planPriceGaps, priceGapReadRange } from './market/price-gaps';
export type { PriceGapPlan } from './market/price-gaps';
export {
  DEFAULT_FINANCIALS_PUBLISH_LAG_DAYS,
  DEFAULT_FINANCIALS_SANITY,
  DEFAULT_PRICE_SANITY,
  DEFAULT_TICK_BANDS,
} from './market/config';
export type { FinancialsSanity, PriceSanity, TickBand } from './market/config';
export { buildPriceBoardRow, isOnTick, priceLimits, splitWatchlistGroups, tickSize } from './market/price-board';
export type { PriceBoardRow, StoredClose } from './market/price-board';
export { normalizeDailyBar, toVnd } from './market/daily-bar';
export type { DailyBar, NormalizeResult, PriceUnit, RawDailyBar } from './market/daily-bar';
export { normalizeQuarterlyFinancials, normalizeSectorLabel, toVndAmount } from './market/financials';
export type {
  FinancialUnit,
  NormalizeFinancialsResult,
  QuarterlyFinancials,
  RawQuarterlyFinancials,
} from './market/financials';
export {
  addQuarters,
  comparePeriods,
  latestExpectedPeriod,
  parsePeriod,
  periodOf,
  planFinancialGaps,
  quarterBounds,
} from './market/quarters';
export type { FinancialGapPlan, OpenGap } from './market/quarters';
export { ROUNDING_MODE, applyRatePpm, mulDiv, roundDiv } from './money';
export { buildLedger } from './ledger/build-ledger';
export { DEFAULT_MARKET_SETTINGS, estimateFees } from './ledger/settings';
export { valueHoldings } from './ledger/valuation';
export type { ValuedHolding } from './ledger/valuation';
export type * from './ledger/types';
export {
  RowMappingError,
  appSettingsFromRow,
  corporateActionFromRow,
  corporateActionToRow,
  settingsFromRow,
  settingsInputToRow,
  settingsToRow,
  toSafeInt,
  transactionFromRow,
  transactionToInsert,
} from './db/mappers';
export type * from './db/rows';
export {
  VN_TIME_ZONE,
  formatDate,
  formatDateTime,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatVnd,
} from './format';
export { PRICE_TONES, changeTone, priceTone } from './tone';
export type { PriceTone } from './tone';
export { normalizeSymbol } from './symbol';
export {
  ASSET_NAME_MAX_LENGTH,
  ASSET_VALUE_MAX,
  DEFAULT_TRADING_RULES,
  INT32_MAX,
  LOW_PRICE_CONFIRM_BELOW,
} from './entry/rules';
export type { TradingRules } from './entry/rules';
export { formatRatePercentInput, parseIntegerInput, parseRatePercentInput } from './entry/parse-input';
export type { ParseIntegerResult, ParseRateResult } from './entry/parse-input';
export {
  DEFAULT_MARKET_RULES,
  EXCHANGES,
  EXCHANGE_LABELS,
  mergeRuleConfigs,
  parseMarketRules,
} from './settings/market-rules';
export type { Exchange, MarketRules } from './settings/market-rules';
export {
  CASH_DIVIDEND_TREATMENTS,
  SETTINGS_BOUNDS,
  concentrationDefaultText,
  settingsToFormValues,
  validateSettingsInput,
} from './settings/validate-settings';
export type {
  AppSettings,
  SettingsField,
  SettingsFormRaw,
  SettingsInput,
  ValidateSettingsResult,
} from './settings/validate-settings';
export { entryMessage } from './entry/messages-vi';
export type { EntryError, EntryErrorCode, EntryParams } from './entry/messages-vi';
export { transactionToFormValues, validateTransactionInput } from './entry/validate-transaction';
export type {
  TransactionField,
  TransactionFormRaw,
  TransactionInput,
  ValidateContext,
  ValidateTransactionResult,
} from './entry/validate-transaction';
export { assetToFormValues, validateAssetInput } from './entry/validate-asset';
export type { AssetField, AssetFormRaw, AssetInput, ValidateAssetResult } from './entry/validate-asset';
export { parseExchangeInput, validateWatchlistInput } from './entry/validate-watchlist';
export type {
  ValidateWatchlistResult,
  WatchlistField,
  WatchlistFormRaw,
  WatchlistInput,
} from './entry/validate-watchlist';
export { checkLedgerChange } from './entry/check-ledger-change';
export type { LedgerChange, LedgerChangeResult } from './entry/check-ledger-change';
export { validateCorporateActionInput } from './entry/validate-corporate-action';
export type {
  CorporateActionField,
  CorporateActionFormRaw,
  CorporateActionInput,
  ValidateCorporateActionResult,
} from './entry/validate-corporate-action';
export { describeCorporateAction } from './entry/describe';
export { buildPortfolio } from './portfolio/build-portfolio';
export type {
  BuildPortfolioInput,
  Portfolio,
  PortfolioRow,
  PortfolioTotals,
  PriceQuote,
} from './portfolio/build-portfolio';
export {
  DEFAULT_CONCENTRATION_THRESHOLD_PPM,
  DEFAULT_PRICE_CUTOFF_MINUTES_VN,
  resolveConcentrationThreshold,
} from './portfolio/config';
export { expectedPriceDate, priceStatus } from './portfolio/freshness';
export type { PriceStatus } from './portfolio/freshness';
export { DEFAULT_SIGNAL_RULES, SIGNAL_RULE_BOUNDS, parseSignalRules } from './signals/config';
export type { SignalRules, ValuationRuleParams } from './signals/config';
export { evaluateMediumSignals } from './signals/evaluate';
export type { EvaluateInput } from './signals/evaluate';
export { resolveSignalDate } from './signals/inputs';
export { checkRawPriceWindow, isBeyondDailyLimit, resolveLimitPpm } from './signals/raw-price-guard';
export type { PriceLimitPpm, RawPriceGuardResult, RawPriceJump } from './signals/raw-price-guard';
export { DATA_REASONS, REASON_ORDER, RULE_IDS, RULE_REASONS, RULE_VERSION, SIGNAL_HORIZON, maRuleId } from './signals/types';
export type {
  EpsBasis,
  GapRef,
  ReasonCode,
  SectorInfo,
  SignalLabel,
  SignalResult,
  SignalStatus,
  StoredFinancials,
} from './signals/types';
