/** Row <-> core conversions only. No financial calculation (R1); integers only (R2). */
import { isValidDate } from '../calendar';
import type { CorporateAction, LedgerSettings, Transaction } from '../ledger/types';
import { DEFAULT_MARKET_SETTINGS } from '../ledger/settings';
import { DEFAULT_MARKET_RULES, mergeRuleConfigs, parseMarketRules } from '../settings/market-rules';
import type { AppSettings, SettingsInput } from '../settings/validate-settings';
import type { CorporateActionRow, SettingsFullRow, SettingsRow, TransactionInsert, TransactionRow } from './rows';

export class RowMappingError extends Error {
  constructor(
    readonly table: string,
    readonly field: string,
    message: string,
  ) {
    super(`${table}.${field}: ${message}`);
    this.name = 'RowMappingError';
  }
}

/** Converts a pg int8 (number, bigint or digit string) to a safe integer, else throws. */
export function toSafeInt(value: unknown, field: string, table = 'row'): number {
  let big: bigint | undefined;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'bigint') big = value;
  else if (typeof value === 'string' && /^-?\d+$/.test(value)) big = BigInt(value);
  if (big === undefined) throw new RowMappingError(table, field, `not an integer: ${String(value)}`);
  const n = Number(big);
  if (!Number.isSafeInteger(n) || BigInt(n) !== big) {
    throw new RowMappingError(table, field, `outside safe integer range: ${String(value)}`);
  }
  return n;
}

function toDate(value: unknown, field: string, table: string): string {
  if (value instanceof Date) {
    throw new RowMappingError(table, field, 'got a Date; configure the driver to return DATE as string (pg type 1082)');
  }
  if (!isValidDate(value)) throw new RowMappingError(table, field, `invalid date: ${String(value)}`);
  return value;
}

function toOptDate(value: unknown, field: string, table: string): string | undefined {
  return value === null || value === undefined ? undefined : toDate(value, field, table);
}

export function transactionFromRow(row: TransactionRow): Transaction {
  const t = 'transactions';
  if (row.side !== 'buy' && row.side !== 'sell') throw new RowMappingError(t, 'side', `invalid side: ${row.side}`);
  const tx: Transaction = {
    id: row.id,
    seq: toSafeInt(row.seq, 'seq', t),
    tradeDate: toDate(row.trade_date, 'trade_date', t),
    symbol: row.symbol,
    side: row.side,
    quantity: toSafeInt(row.quantity, 'quantity', t),
    price: toSafeInt(row.price, 'price', t),
  };
  if (row.fee !== null) tx.fee = toSafeInt(row.fee, 'fee', t);
  if (row.tax !== null) tx.tax = toSafeInt(row.tax, 'tax', t);
  return tx;
}

export function transactionToInsert(
  tx: Omit<Transaction, 'id' | 'seq'> & { id?: string },
  meta: { source: 'manual' | 'import'; importBatchId?: string; externalRef?: string },
): TransactionInsert {
  const insert: TransactionInsert = {
    trade_date: tx.tradeDate,
    symbol: tx.symbol,
    side: tx.side,
    quantity: tx.quantity,
    price: tx.price,
    fee: tx.fee ?? null,
    tax: tx.tax ?? null,
    source: meta.source,
    import_batch_id: meta.importBatchId ?? null,
    external_ref: meta.externalRef ?? null,
  };
  if (tx.id !== undefined) insert.id = tx.id;
  return insert;
}

export function corporateActionFromRow(row: CorporateActionRow): CorporateAction {
  const t = 'corporate_actions';
  const exDate = toDate(row.ex_date, 'ex_date', t);
  if (row.type === 'cash_dividend') {
    if (row.amount_per_share === null) throw new RowMappingError(t, 'amount_per_share', 'null for cash_dividend');
    const action: CorporateAction = {
      type: 'cash_dividend',
      id: row.id,
      symbol: row.symbol,
      exDate,
      amountPerShare: toSafeInt(row.amount_per_share, 'amount_per_share', t),
    };
    const payDate = toOptDate(row.pay_date, 'pay_date', t);
    if (payDate !== undefined) action.payDate = payDate;
    return action;
  }
  if (row.type === 'stock_dividend') {
    if (row.ratio_num === null) throw new RowMappingError(t, 'ratio_num', 'null for stock_dividend');
    if (row.ratio_den === null) throw new RowMappingError(t, 'ratio_den', 'null for stock_dividend');
    const action: CorporateAction = {
      type: 'stock_dividend',
      id: row.id,
      symbol: row.symbol,
      exDate,
      ratio: { held: toSafeInt(row.ratio_den, 'ratio_den', t), received: toSafeInt(row.ratio_num, 'ratio_num', t) },
    };
    const listingDate = toOptDate(row.listing_date, 'listing_date', t);
    if (listingDate !== undefined) action.listingDate = listingDate;
    return action;
  }
  throw new RowMappingError(t, 'type', `invalid type: ${row.type}`);
}

export function corporateActionToRow(
  action: CorporateAction,
  meta: { recordDate?: string } = {},
): CorporateActionRow {
  const base = {
    id: action.id,
    symbol: action.symbol,
    ex_date: action.exDate,
    record_date: meta.recordDate ?? null,
  };
  if (action.type === 'cash_dividend') {
    return {
      ...base,
      type: action.type,
      pay_date: action.payDate ?? null,
      listing_date: null,
      amount_per_share: action.amountPerShare,
      ratio_num: null,
      ratio_den: null,
    };
  }
  return {
    ...base,
    type: action.type,
    pay_date: null,
    listing_date: action.listingDate ?? null,
    amount_per_share: null,
    ratio_num: action.ratio.received,
    ratio_den: action.ratio.held,
  };
}

export function settingsFromRow(row: SettingsRow): LedgerSettings {
  const t = 'settings';
  if (row.fee_rate_ppm === null) {
    throw new RowMappingError(t, 'fee_rate_ppm', 'fee rate is not set; enter your brokerage rate');
  }
  if (row.cash_dividend_treatment !== 'reduceCost' && row.cash_dividend_treatment !== 'income') {
    throw new RowMappingError(t, 'cash_dividend_treatment', `invalid value: ${row.cash_dividend_treatment}`);
  }
  if (row.cost_method !== 'WAC') throw new RowMappingError(t, 'cost_method', `invalid value: ${row.cost_method}`);
  return {
    feeRatePpm: toSafeInt(row.fee_rate_ppm, 'fee_rate_ppm', t),
    sellTaxRatePpm: toSafeInt(row.sell_tax_rate_ppm, 'sell_tax_rate_ppm', t),
    settlementDays: toSafeInt(row.settlement_days, 'settlement_days', t),
    holidays: row.holidays,
    dividendWithholdingRatePpm: toSafeInt(row.dividend_withholding_rate_ppm, 'dividend_withholding_rate_ppm', t),
    cashDividendTreatment: row.cash_dividend_treatment,
    costMethod: row.cost_method,
  };
}

/** Writes ledger columns only; rule_configs and concentration threshold are managed elsewhere. */
export function settingsToRow(s: Omit<LedgerSettings, 'feeRatePpm'> & { feeRatePpm: number | null }): SettingsRow {
  return {
    id: 1,
    fee_rate_ppm: s.feeRatePpm,
    sell_tax_rate_ppm: s.sellTaxRatePpm,
    dividend_withholding_rate_ppm: s.dividendWithholdingRatePpm,
    settlement_days: s.settlementDays,
    holidays: [...s.holidays],
    cash_dividend_treatment: s.cashDividendTreatment,
    cost_method: s.costMethod,
  };
}

/** Row -> settings screen model. A missing row gives the market defaults; fee and concentration may be null. */
export function appSettingsFromRow(row: SettingsFullRow | null): AppSettings {
  if (row === null) {
    return {
      ...DEFAULT_MARKET_SETTINGS,
      feeRatePpm: null,
      concentrationThresholdPpm: null,
      marketRules: DEFAULT_MARKET_RULES,
    };
  }
  const t = 'settings';
  if (row.cash_dividend_treatment !== 'reduceCost' && row.cash_dividend_treatment !== 'income') {
    throw new RowMappingError(t, 'cash_dividend_treatment', `invalid value: ${row.cash_dividend_treatment}`);
  }
  if (row.cost_method !== 'WAC') throw new RowMappingError(t, 'cost_method', `invalid value: ${row.cost_method}`);
  return {
    feeRatePpm: row.fee_rate_ppm === null ? null : toSafeInt(row.fee_rate_ppm, 'fee_rate_ppm', t),
    sellTaxRatePpm: toSafeInt(row.sell_tax_rate_ppm, 'sell_tax_rate_ppm', t),
    settlementDays: toSafeInt(row.settlement_days, 'settlement_days', t),
    holidays: row.holidays,
    dividendWithholdingRatePpm: toSafeInt(row.dividend_withholding_rate_ppm, 'dividend_withholding_rate_ppm', t),
    cashDividendTreatment: row.cash_dividend_treatment,
    costMethod: row.cost_method,
    concentrationThresholdPpm:
      row.concentration_threshold_ppm === null ? null : toSafeInt(row.concentration_threshold_ppm, 'concentration_threshold_ppm', t),
    marketRules: parseMarketRules(row.rule_configs),
  };
}

/**
 * Settings form input -> full row. Withholding, holidays and cost method are not on the form: they are
 * kept from the existing row (or the defaults), and rule_configs is merged so other namespaces survive.
 */
export function settingsInputToRow(input: SettingsInput, existing: SettingsFullRow | null): SettingsFullRow {
  return {
    id: 1,
    fee_rate_ppm: input.feeRatePpm,
    sell_tax_rate_ppm: input.sellTaxRatePpm,
    dividend_withholding_rate_ppm:
      existing?.dividend_withholding_rate_ppm ?? DEFAULT_MARKET_SETTINGS.dividendWithholdingRatePpm,
    settlement_days: input.settlementDays,
    holidays: existing ? [...existing.holidays] : [...DEFAULT_MARKET_SETTINGS.holidays],
    cash_dividend_treatment: input.cashDividendTreatment,
    cost_method: existing?.cost_method ?? DEFAULT_MARKET_SETTINGS.costMethod,
    concentration_threshold_ppm: input.concentrationThresholdPpm,
    rule_configs: mergeRuleConfigs(existing?.rule_configs, { lotSize: input.lotSize, priceLimitPpm: input.priceLimitPpm }),
  };
}
