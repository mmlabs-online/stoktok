export function describeCore(): string {
  return '@stoktok/core';
}

export { addTradingDays, isTradingDay } from './calendar';
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
