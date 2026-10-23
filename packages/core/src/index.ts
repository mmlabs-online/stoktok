export function describeCore(): string {
  return '@stoktok/core';
}

export { addTradingDays, isTradingDay, isValidDate, previousTradingDay, vnDateOf, vnMinutesOf } from './calendar';
export { ROUNDING_MODE, applyRatePpm, mulDiv, roundDiv } from './money';
export { buildLedger } from './ledger/build-ledger';
export { DEFAULT_MARKET_SETTINGS, estimateFees } from './ledger/settings';
export { valueHoldings } from './ledger/valuation';
export type { ValuedHolding } from './ledger/valuation';
export type * from './ledger/types';
export {
  RowMappingError,
  corporateActionFromRow,
  corporateActionToRow,
  settingsFromRow,
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
export { DEFAULT_TRADING_RULES, INT32_MAX, LOW_PRICE_CONFIRM_BELOW } from './entry/rules';
export type { TradingRules } from './entry/rules';
export { parseIntegerInput } from './entry/parse-input';
export type { ParseIntegerResult } from './entry/parse-input';
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
