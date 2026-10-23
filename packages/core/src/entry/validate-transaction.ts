import { isValidDate } from '../calendar';
import type { Transaction } from '../ledger/types';
import { normalizeSymbol } from '../symbol';
import type { EntryError } from './messages-vi';
import { parseIntegerInput } from './parse-input';
import { INT32_MAX, LOW_PRICE_CONFIRM_BELOW } from './rules';
import type { TradingRules } from './rules';

export interface TransactionFormRaw {
  tradeDate: string;
  symbol: string;
  side: string;
  quantity: string;
  price: string;
  fee: string;
  tax: string;
  oddLot: boolean;
  confirmLowPrice: boolean;
}

export type TransactionField = 'tradeDate' | 'symbol' | 'side' | 'quantity' | 'price' | 'fee' | 'tax';

export type TransactionInput = Omit<Transaction, 'id' | 'seq'>;

export type ValidateTransactionResult =
  | { ok: true; value: TransactionInput }
  | { ok: false; errors: Partial<Record<TransactionField, EntryError>> };

export interface ValidateContext {
  rules: TradingRules;
  /** 'YYYY-MM-DD' in Vietnam time. */
  today: string;
  /** False while settings.fee_rate_ppm is unset: fee (and tax on sells) must then be entered. */
  feeRateConfigured: boolean;
}

/** Validates form strings into a typed transaction. Collects all field errors; never throws. */
export function validateTransactionInput(raw: TransactionFormRaw, ctx: ValidateContext): ValidateTransactionResult {
  const errors: Partial<Record<TransactionField, EntryError>> = {};

  const tradeDate = raw.tradeDate.trim();
  if (tradeDate === '') errors.tradeDate = { code: 'REQUIRED' };
  else if (!isValidDate(tradeDate)) errors.tradeDate = { code: 'DATE_INVALID' };
  else if (tradeDate > ctx.today) errors.tradeDate = { code: 'DATE_IN_FUTURE' };

  const symbol = normalizeSymbol(raw.symbol);
  if (symbol === null) errors.symbol = { code: 'SYMBOL_INVALID' };

  const side = raw.side === 'buy' || raw.side === 'sell' ? raw.side : null;
  if (side === null) errors.side = { code: 'SIDE_INVALID' };

  let quantity = 0;
  const q = parseIntegerInput(raw.quantity, { max: INT32_MAX });
  if (!q.ok) errors.quantity = { code: q.code };
  else if (q.value <= 0) errors.quantity = { code: 'QTY_NOT_POSITIVE' };
  else if (!raw.oddLot && q.value % ctx.rules.lotSize !== 0) {
    errors.quantity = { code: 'QTY_NOT_LOT', params: { lotSize: ctx.rules.lotSize } };
  } else quantity = q.value;

  let price = 0;
  const p = parseIntegerInput(raw.price, { max: INT32_MAX });
  if (!p.ok) errors.price = { code: p.code };
  else if (p.value <= 0) errors.price = { code: 'PRICE_NOT_POSITIVE' };
  else if (p.value < LOW_PRICE_CONFIRM_BELOW && !raw.confirmLowPrice) errors.price = { code: 'PRICE_LOW_UNCONFIRMED' };
  else price = p.value;

  let fee: number | undefined;
  if (raw.fee.trim() === '') {
    if (!ctx.feeRateConfigured) errors.fee = { code: 'FEE_REQUIRED_NO_RATE' };
  } else {
    const f = parseIntegerInput(raw.fee, { max: Number.MAX_SAFE_INTEGER });
    if (!f.ok) errors.fee = { code: f.code };
    else fee = f.value;
  }

  let tax: number | undefined;
  if (raw.tax.trim() === '') {
    if (!ctx.feeRateConfigured && side === 'sell') errors.tax = { code: 'TAX_REQUIRED_NO_RATE' };
  } else {
    const t = parseIntegerInput(raw.tax, { max: Number.MAX_SAFE_INTEGER });
    if (!t.ok) errors.tax = { code: t.code };
    else tax = t.value;
  }

  if (Object.keys(errors).length > 0 || symbol === null || side === null) return { ok: false, errors };
  const value: TransactionInput = { tradeDate, symbol, side, quantity, price };
  if (fee !== undefined) value.fee = fee;
  if (tax !== undefined) value.tax = tax;
  return { ok: true, value };
}

/** Form strings for editing a stored transaction. */
export function transactionToFormValues(tx: Transaction, rules: TradingRules): TransactionFormRaw {
  return {
    tradeDate: tx.tradeDate,
    symbol: tx.symbol,
    side: tx.side,
    quantity: String(tx.quantity),
    price: String(tx.price),
    fee: tx.fee === undefined ? '' : String(tx.fee),
    tax: tx.tax === undefined ? '' : String(tx.tax),
    oddLot: tx.quantity % rules.lotSize !== 0,
    confirmLowPrice: tx.price < LOW_PRICE_CONFIRM_BELOW,
  };
}
