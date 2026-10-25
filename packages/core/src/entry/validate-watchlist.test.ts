import { describe, expect, it } from 'vitest';
import { parseExchangeInput, validateWatchlistInput } from './validate-watchlist';

describe('validateWatchlistInput', () => {
  it('normalizes the symbol and accepts a blank exchange as null', () => {
    expect(validateWatchlistInput({ symbol: ' vnm ', exchange: '' })).toEqual({
      ok: true,
      value: { symbol: 'VNM', exchange: null },
    });
  });
  it('empty symbol is REQUIRED, bad symbol is SYMBOL_INVALID', () => {
    const empty = validateWatchlistInput({ symbol: '', exchange: '' });
    expect(empty.ok === false && empty.errors.symbol?.code).toBe('REQUIRED');
    const bad = validateWatchlistInput({ symbol: 'V!', exchange: '' });
    expect(bad.ok === false && bad.errors.symbol?.code).toBe('SYMBOL_INVALID');
  });
  it.each([
    ['HOSE', 'HOSE'],
    ['hnx', 'HNX'],
    ['UPCOM', 'UPCOM'],
  ])('exchange %s is accepted', (raw, want) => {
    expect(parseExchangeInput(raw)).toEqual({ ok: true, exchange: want });
  });
  it.each(['HSX', 'UPCoM x', 'HOSE HNX'])('exchange %s is EXCHANGE_INVALID', (raw) => {
    expect(parseExchangeInput(raw)).toEqual({ ok: false });
    const r = validateWatchlistInput({ symbol: 'VNM', exchange: raw });
    expect(r.ok === false && r.errors.exchange?.code).toBe('EXCHANGE_INVALID');
  });
  it('mixed-case UPCoM is accepted', () => {
    expect(parseExchangeInput('UPCoM ')).toEqual({ ok: true, exchange: 'UPCOM' });
  });
  it('reports both errors together', () => {
    const r = validateWatchlistInput({ symbol: '', exchange: 'X' });
    expect(r.ok === false && Object.keys(r.errors).sort()).toEqual(['exchange', 'symbol']);
  });
});
