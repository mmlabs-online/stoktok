import { describe, expect, it } from 'vitest';
import { validateCorporateActionInput } from './validate-corporate-action';
import type { CorporateActionFormRaw } from './validate-corporate-action';

const raw = (o: Partial<CorporateActionFormRaw> = {}): CorporateActionFormRaw => ({
  type: 'cash_dividend',
  symbol: 'fpt',
  exDate: '2026-10-20',
  amountPerShare: '1.000',
  payDate: '',
  held: '',
  received: '',
  listingDate: '',
  ...o,
});
const errs = (o: Partial<CorporateActionFormRaw>) => {
  const r = validateCorporateActionInput(raw(o));
  if (r.ok) throw new Error('expected errors');
  return r.errors;
};

describe('validateCorporateActionInput', () => {
  it('accepts a cash dividend with optional payDate', () => {
    expect(validateCorporateActionInput(raw())).toEqual({
      ok: true,
      value: { type: 'cash_dividend', symbol: 'FPT', exDate: '2026-10-20', amountPerShare: 1000 },
    });
    expect(validateCorporateActionInput(raw({ payDate: '2026-10-20' }))).toMatchObject({
      value: { payDate: '2026-10-20' },
    });
  });
  it('rejects a non-positive or non-integer cash amount', () => {
    expect(errs({ amountPerShare: '0' }).amountPerShare?.code).toBe('AMOUNT_NOT_POSITIVE');
    expect(errs({ amountPerShare: '1,5' }).amountPerShare?.code).toBe('NOT_INTEGER');
  });
  it('accepts a stock dividend with optional listingDate', () => {
    const r = validateCorporateActionInput(
      raw({ type: 'stock_dividend', held: '100', received: '20', listingDate: '2026-10-30', amountPerShare: '' }),
    );
    expect(r).toEqual({
      ok: true,
      value: {
        type: 'stock_dividend',
        symbol: 'FPT',
        exDate: '2026-10-20',
        ratio: { held: 100, received: 20 },
        listingDate: '2026-10-30',
      },
    });
  });
  it('rejects a zero ratio side', () => {
    expect(errs({ type: 'stock_dividend', held: '0', received: '20' }).held?.code).toBe('RATIO_NOT_POSITIVE');
  });
  it('rejects payDate or listingDate before exDate', () => {
    expect(errs({ payDate: '2026-10-19' }).payDate?.code).toBe('DATE_BEFORE_EX');
    expect(
      errs({ type: 'stock_dividend', held: '1', received: '1', listingDate: '2026-10-19' }).listingDate?.code,
    ).toBe('DATE_BEFORE_EX');
  });
  it('rejects rights_issue and unknown types', () => {
    expect(errs({ type: 'rights_issue' }).type?.code).toBe('CA_TYPE_UNSUPPORTED');
    expect(errs({ type: 'x' }).type?.code).toBe('CA_TYPE_UNSUPPORTED');
  });
  it('rejects a bad symbol and a bad exDate', () => {
    expect(errs({ symbol: '!' }).symbol?.code).toBe('SYMBOL_INVALID');
    expect(errs({ exDate: '' }).exDate?.code).toBe('REQUIRED');
    expect(errs({ exDate: '2026-13-01' }).exDate?.code).toBe('DATE_INVALID');
  });
});
