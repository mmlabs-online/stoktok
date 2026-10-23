import { describe, expect, it } from 'vitest';
import type { Transaction } from '../ledger/types';
import { DEFAULT_TRADING_RULES } from './rules';
import { transactionToFormValues, validateTransactionInput } from './validate-transaction';
import type { TransactionFormRaw, ValidateContext } from './validate-transaction';

const ctx: ValidateContext = { rules: DEFAULT_TRADING_RULES, today: '2026-10-23', feeRateConfigured: true };
const raw = (o: Partial<TransactionFormRaw> = {}): TransactionFormRaw => ({
  tradeDate: '2026-10-20',
  symbol: 'FPT',
  side: 'buy',
  quantity: '100',
  price: '125400',
  fee: '',
  tax: '',
  oddLot: false,
  confirmLowPrice: false,
  ...o,
});
const errs = (o: Partial<TransactionFormRaw>, c: ValidateContext = ctx) => {
  const r = validateTransactionInput(raw(o), c);
  if (r.ok) throw new Error('expected errors');
  return r.errors;
};

describe('validateTransactionInput', () => {
  it('returns a typed buy and omits blank fee and tax', () => {
    expect(validateTransactionInput(raw(), ctx)).toEqual({
      ok: true,
      value: { tradeDate: '2026-10-20', symbol: 'FPT', side: 'buy', quantity: 100, price: 125400 },
    });
  });
  it('keeps entered fee and tax', () => {
    const r = validateTransactionInput(raw({ side: 'sell', fee: '1.000', tax: '0' }), ctx);
    expect(r).toMatchObject({ ok: true, value: { fee: 1000, tax: 0 } });
  });
  it('normalises the symbol and rejects a bad one', () => {
    expect(validateTransactionInput(raw({ symbol: ' fpt ' }), ctx)).toMatchObject({ value: { symbol: 'FPT' } });
    expect(errs({ symbol: 'F' }).symbol?.code).toBe('SYMBOL_INVALID');
  });
  it('checks the date', () => {
    expect(errs({ tradeDate: 'nope' }).tradeDate?.code).toBe('DATE_INVALID');
    expect(errs({ tradeDate: '2026-02-30' }).tradeDate?.code).toBe('DATE_INVALID');
    expect(errs({ tradeDate: '2026-10-24' }).tradeDate?.code).toBe('DATE_IN_FUTURE');
    expect(validateTransactionInput(raw({ tradeDate: '2026-10-23' }), ctx).ok).toBe(true);
  });
  it('rejects a side that is not buy or sell', () => {
    expect(errs({ side: 'hold' }).side?.code).toBe('SIDE_INVALID');
  });
  it('checks the price', () => {
    expect(errs({ price: '0' }).price?.code).toBe('PRICE_NOT_POSITIVE');
    expect(errs({ price: '2147483648' }).price?.code).toBe('TOO_LARGE');
    expect(errs({ price: '500' }).price?.code).toBe('PRICE_LOW_UNCONFIRMED');
    expect(validateTransactionInput(raw({ price: '500', confirmLowPrice: true }), ctx).ok).toBe(true);
  });
  it('checks quantity against the lot size unless odd lot', () => {
    const e = errs({ quantity: '150' }).quantity;
    expect(e?.code).toBe('QTY_NOT_LOT');
    expect(e?.params).toEqual({ lotSize: 100 });
    expect(validateTransactionInput(raw({ quantity: '150', oddLot: true }), ctx).ok).toBe(true);
    expect(validateTransactionInput(raw({ quantity: '115', oddLot: true }), ctx)).toMatchObject({
      value: { quantity: 115 },
    });
  });
  it('uses the lot size from the rules (R5)', () => {
    const c = { ...ctx, rules: { lotSize: 10 } };
    expect(validateTransactionInput(raw({ quantity: '50' }), c).ok).toBe(true);
  });
  it('rejects zero and oversized quantity', () => {
    expect(errs({ quantity: '0' }).quantity?.code).toBe('QTY_NOT_POSITIVE');
    expect(errs({ quantity: '2147483648' }).quantity?.code).toBe('TOO_LARGE');
  });
  it('checks fee and tax as non-negative integers', () => {
    expect(errs({ fee: '-1' }).fee?.code).toBe('NOT_INTEGER');
    expect(errs({ fee: '1,5' }).fee?.code).toBe('NOT_INTEGER');
    expect(errs({ tax: 'x' }).tax?.code).toBe('NOT_INTEGER');
    expect(validateTransactionInput(raw({ fee: '0' }), ctx)).toMatchObject({ value: { fee: 0 } });
  });
  it('requires fee (and tax on sells) when no rate is configured', () => {
    const c = { ...ctx, feeRateConfigured: false };
    expect(errs({ fee: '' }, c).fee?.code).toBe('FEE_REQUIRED_NO_RATE');
    expect(errs({ side: 'sell', fee: '10' }, c).tax?.code).toBe('TAX_REQUIRED_NO_RATE');
    expect(validateTransactionInput(raw({ fee: '10' }), c).ok).toBe(true);
  });
  it('returns all field errors at once', () => {
    const e = errs({ price: '0', quantity: '150' });
    expect(e.price?.code).toBe('PRICE_NOT_POSITIVE');
    expect(e.quantity?.code).toBe('QTY_NOT_LOT');
  });
});

describe('transactionToFormValues', () => {
  const tx: Transaction = {
    id: 'a',
    seq: 1,
    tradeDate: '2026-10-20',
    symbol: 'FPT',
    side: 'buy',
    quantity: 200,
    price: 125400,
  };
  it('maps to strings and derives oddLot from the lot size', () => {
    expect(transactionToFormValues(tx, DEFAULT_TRADING_RULES)).toMatchObject({
      quantity: '200',
      price: '125400',
      fee: '',
      tax: '',
      oddLot: false,
      confirmLowPrice: false,
    });
    expect(transactionToFormValues({ ...tx, quantity: 115, fee: 5 }, DEFAULT_TRADING_RULES)).toMatchObject({
      oddLot: true,
      fee: '5',
    });
  });
  it('pre-confirms a stored low price so it can be re-saved', () => {
    expect(transactionToFormValues({ ...tx, price: 500 }, DEFAULT_TRADING_RULES).confirmLowPrice).toBe(true);
  });
});
