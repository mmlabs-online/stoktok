import { isValidDate } from '../calendar';
import type { CorporateAction } from '../ledger/types';
import { normalizeSymbol } from '../symbol';
import type { EntryError } from './messages-vi';
import { parseIntegerInput } from './parse-input';
import { INT32_MAX } from './rules';

export interface CorporateActionFormRaw {
  type: string;
  symbol: string;
  exDate: string;
  amountPerShare: string;
  payDate: string;
  held: string;
  received: string;
  listingDate: string;
}

export type CorporateActionField = keyof CorporateActionFormRaw;

export type CorporateActionInput = CorporateAction extends infer A
  ? A extends unknown
    ? Omit<A, 'id'>
    : never
  : never;

export type ValidateCorporateActionResult =
  | { ok: true; value: CorporateActionInput }
  | { ok: false; errors: Partial<Record<CorporateActionField, EntryError>> };

/** Rights issue is not supported yet (STK-008 plan A1): it is rejected like any unknown type. */
export function validateCorporateActionInput(raw: CorporateActionFormRaw): ValidateCorporateActionResult {
  if (raw.type !== 'cash_dividend' && raw.type !== 'stock_dividend') {
    return { ok: false, errors: { type: { code: 'CA_TYPE_UNSUPPORTED' } } };
  }
  const errors: Partial<Record<CorporateActionField, EntryError>> = {};

  const symbol = normalizeSymbol(raw.symbol);
  if (symbol === null) errors.symbol = { code: 'SYMBOL_INVALID' };

  const exDate = raw.exDate.trim();
  if (exDate === '') errors.exDate = { code: 'REQUIRED' };
  else if (!isValidDate(exDate)) errors.exDate = { code: 'DATE_INVALID' };

  /** Optional date on or after exDate; blank is omitted. */
  const optionalDate = (field: 'payDate' | 'listingDate'): string | undefined => {
    const d = raw[field].trim();
    if (d === '') return undefined;
    if (!isValidDate(d)) errors[field] = { code: 'DATE_INVALID' };
    else if (!errors.exDate && d < exDate) errors[field] = { code: 'DATE_BEFORE_EX' };
    return d;
  };

  if (raw.type === 'cash_dividend') {
    const payDate = optionalDate('payDate');
    let amountPerShare = 0;
    const a = parseIntegerInput(raw.amountPerShare, { max: INT32_MAX });
    if (!a.ok) errors.amountPerShare = { code: a.code };
    else if (a.value <= 0) errors.amountPerShare = { code: 'AMOUNT_NOT_POSITIVE' };
    else amountPerShare = a.value;
    if (Object.keys(errors).length > 0 || symbol === null) return { ok: false, errors };
    const value: CorporateActionInput = { type: 'cash_dividend', symbol, exDate, amountPerShare };
    if (payDate !== undefined) value.payDate = payDate;
    return { ok: true, value };
  }

  const listingDate = optionalDate('listingDate');
  const ratio = { held: 0, received: 0 };
  for (const f of ['held', 'received'] as const) {
    const r = parseIntegerInput(raw[f], { max: INT32_MAX });
    if (!r.ok) errors[f] = { code: r.code };
    else if (r.value <= 0) errors[f] = { code: 'RATIO_NOT_POSITIVE' };
    else ratio[f] = r.value;
  }
  if (Object.keys(errors).length > 0 || symbol === null) return { ok: false, errors };
  const value: CorporateActionInput = { type: 'stock_dividend', symbol, exDate, ratio };
  if (listingDate !== undefined) value.listingDate = listingDate;
  return { ok: true, value };
}
