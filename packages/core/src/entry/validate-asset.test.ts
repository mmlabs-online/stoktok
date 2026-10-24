import { describe, expect, it } from 'vitest';
import { assetToFormValues, validateAssetInput } from './validate-asset';
import type { AssetFormRaw } from './validate-asset';
import { ASSET_VALUE_MAX } from './rules';

const today = '2026-10-23';
const raw = (o: Partial<AssetFormRaw> = {}): AssetFormRaw => ({
  type: 'cash',
  name: 'TCBS',
  value: '125.400',
  asOf: '2026-10-20',
  ...o,
});
const errs = (o: Partial<AssetFormRaw>) => {
  const r = validateAssetInput(raw(o), { today });
  return r.ok ? null : r.errors;
};

describe('validateAssetInput', () => {
  it('accepts cash and other with integer value and trimmed name', () => {
    expect(validateAssetInput(raw({ name: '  TCBS   tiền  ' }), { today })).toEqual({
      ok: true,
      value: { type: 'cash', name: 'TCBS tiền', value: 125400, asOf: '2026-10-20' },
    });
    expect(validateAssetInput(raw({ type: 'other' }), { today })).toMatchObject({ ok: true, value: { type: 'other' } });
  });

  it('rejects bad types and still reports the other fields', () => {
    for (const type of ['', 'CASH', 'stock']) expect(errs({ type })?.type?.code).toBe('ASSET_TYPE_INVALID');
    const e = errs({ type: 'stock', name: '', value: 'abc', asOf: '' });
    expect(Object.keys(e ?? {}).sort()).toEqual(['asOf', 'name', 'type', 'value']);
  });

  it('name: required, collapsed, NFC, 100 code point limit', () => {
    expect(errs({ name: '' })?.name?.code).toBe('REQUIRED');
    expect(errs({ name: '   ' })?.name?.code).toBe('REQUIRED');
    expect(errs({ name: 'a'.repeat(100) })).toBeNull();
    expect(errs({ name: 'a'.repeat(101) })?.name?.code).toBe('NAME_TOO_LONG');
    const decomposed = 'ệ'.normalize('NFD').repeat(100);
    expect(decomposed.length).toBeGreaterThan(100);
    const r = validateAssetInput(raw({ name: decomposed }), { today });
    expect(r.ok).toBe(true);
  });

  it('value: 0 allowed, grouped dots, integer only, capped', () => {
    expect(validateAssetInput(raw({ value: '0' }), { today })).toMatchObject({ ok: true, value: { value: 0 } });
    expect(errs({ value: '' })?.value?.code).toBe('REQUIRED');
    for (const value of ['abc', '-1', '1,5', '1.5']) expect(errs({ value })?.value?.code).toBe('NOT_INTEGER');
    expect(errs({ value: '100.000.000.000.000' })).toBeNull();
    expect(ASSET_VALUE_MAX).toBe(100_000_000_000_000);
    expect(errs({ value: '100000000000001' })?.value?.code).toBe('TOO_LARGE');
    expect(errs({ value: '12345678901234567890' })?.value?.code).toBe('TOO_LARGE');
  });

  it('asOf: today and past pass, future and invalid dates fail', () => {
    expect(errs({ asOf: today })).toBeNull();
    expect(errs({ asOf: '2020-01-01' })).toBeNull();
    expect(errs({ asOf: '2026-10-24' })?.asOf?.code).toBe('AS_OF_IN_FUTURE');
    expect(errs({ asOf: '2026-02-30' })?.asOf?.code).toBe('DATE_INVALID');
    expect(errs({ asOf: '' })?.asOf?.code).toBe('REQUIRED');
  });
});

describe('assetToFormValues', () => {
  it('stringifies the value and passes the rest through', () => {
    expect(assetToFormValues({ type: 'other', name: 'Vàng', value: 50000000, asOf: '2026-10-01' })).toEqual({
      type: 'other',
      name: 'Vàng',
      value: '50000000',
      asOf: '2026-10-01',
    });
  });
});
