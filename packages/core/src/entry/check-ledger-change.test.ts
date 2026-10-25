import { describe, expect, it } from 'vitest';
import { DEFAULT_MARKET_SETTINGS } from '../ledger/settings';
import type { CorporateAction, LedgerSettings, Transaction } from '../ledger/types';
import { checkLedgerChange } from './check-ledger-change';
import type { LedgerChange } from './check-ledger-change';

const settings: LedgerSettings = { ...DEFAULT_MARKET_SETTINGS, feeRatePpm: 0 };
const today = '2026-10-23';

const t = (id: string, seq: number, tradeDate: string, side: 'buy' | 'sell', quantity: number): Transaction => ({
  id,
  seq,
  tradeDate,
  symbol: 'FPT',
  side,
  quantity,
  price: 100000,
});
const input = (tradeDate: string, side: 'buy' | 'sell', quantity: number) => ({
  tradeDate,
  symbol: 'FPT',
  side,
  quantity,
  price: 100000,
});
const check = (transactions: Transaction[], change: LedgerChange, actions: CorporateAction[] = []) =>
  checkLedgerChange({ transactions, actions, settings, today, change });

// 2026-10-12 is a Monday: settles Wed 2026-10-14.
const buy1 = t('b1', 1, '2026-10-12', 'buy', 300);

describe('checkLedgerChange add', () => {
  it('allows a sell within the sellable quantity', () => {
    expect(check([buy1], { kind: 'add', input: input('2026-10-14', 'sell', 300) })).toEqual({ ok: true });
  });
  it('rejects a sell above sellable with OVERSELL_SELF details', () => {
    const r = check([buy1], { kind: 'add', input: input('2026-10-14', 'sell', 400) });
    expect(r).toEqual({
      ok: false,
      error: {
        code: 'OVERSELL_SELF',
        params: { symbol: 'FPT', date: '2026-10-14', requested: 400, sellable: 300, settlementDays: 2 },
      },
    });
  });
  it('rejects a sell on T+1 (settlement pending)', () => {
    const r = check([buy1], { kind: 'add', input: input('2026-10-13', 'sell', 100) });
    expect(r).toMatchObject({ ok: false, error: { code: 'OVERSELL_SELF', params: { sellable: 0 } } });
  });
  it('handles partial sells across lots', () => {
    const txs = [t('b1', 1, '2026-10-05', 'buy', 100), t('b2', 2, '2026-10-06', 'buy', 200)];
    expect(check(txs, { kind: 'add', input: input('2026-10-12', 'sell', 250) }).ok).toBe(true);
    expect(check(txs, { kind: 'add', input: input('2026-10-12', 'sell', 301) }).ok).toBe(false);
  });
  it('counts a stock dividend lot only from its listing date', () => {
    const txs = [t('b1', 1, '2026-09-01', 'buy', 100)];
    const actions: CorporateAction[] = [
      { type: 'stock_dividend', id: 'a1', symbol: 'FPT', exDate: '2026-10-01', ratio: { held: 100, received: 20 }, listingDate: '2026-10-15' },
    ];
    expect(check(txs, { kind: 'add', input: input('2026-10-14', 'sell', 120) }, actions).ok).toBe(false);
    expect(check(txs, { kind: 'add', input: input('2026-10-15', 'sell', 120) }, actions).ok).toBe(true);
  });
  it('works without a configured fee rate (feeRatePpm 0)', () => {
    expect(check([], { kind: 'add', input: input('2026-10-12', 'buy', 100) }).ok).toBe(true);
  });
  it('checks future-dated sells already in the ledger (asOf covers the latest date)', () => {
    const txs = [buy1, t('s1', 2, '2026-11-02', 'sell', 300)];
    const r = check(txs, { kind: 'add', input: input('2026-10-30', 'sell', 100) });
    expect(r.ok).toBe(false);
  });
  it('gives a new transaction seq = max + 1 (sorts last on its day)', () => {
    const txs = [t('b1', 1, '2026-10-12', 'buy', 100), t('s0', 2, '2026-10-14', 'sell', 100)];
    // New buy on the sell's day with a higher seq does not fund the earlier sell.
    expect(check(txs, { kind: 'add', input: input('2026-10-14', 'buy', 100) }).ok).toBe(true);
  });
});

describe('checkLedgerChange edit and delete', () => {
  const sell1 = t('s1', 2, '2026-10-16', 'sell', 200);
  it('rejects lowering a buy below a later sell (OVERSELL_OTHER)', () => {
    const r = check([buy1, sell1], { kind: 'edit', id: 'b1', input: input('2026-10-12', 'buy', 100) });
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'OVERSELL_OTHER', params: { date: '2026-10-16', requested: 200, sellable: 100 } },
    });
  });
  it('rejects moving a buy later so a sell falls before its T+2', () => {
    const r = check([buy1, sell1], { kind: 'edit', id: 'b1', input: input('2026-10-15', 'buy', 300) });
    expect(r).toMatchObject({ ok: false, error: { code: 'OVERSELL_OTHER' } });
  });
  it('edit that stays valid is ok and keeps seq', () => {
    expect(check([buy1, sell1], { kind: 'edit', id: 's1', input: input('2026-10-16', 'sell', 300) }).ok).toBe(true);
  });
  it('edit of own sell above sellable is OVERSELL_SELF', () => {
    const r = check([buy1, sell1], { kind: 'edit', id: 's1', input: input('2026-10-16', 'sell', 301) });
    expect(r).toMatchObject({ ok: false, error: { code: 'OVERSELL_SELF' } });
  });
  it('rejects deleting a buy that funds a later sell; deleting the sell is ok', () => {
    expect(check([buy1, sell1], { kind: 'delete', id: 'b1' })).toMatchObject({
      ok: false,
      error: { code: 'OVERSELL_OTHER' },
    });
    expect(check([buy1, sell1], { kind: 'delete', id: 's1' }).ok).toBe(true);
  });
  it('returns NOT_FOUND for an unknown id', () => {
    expect(check([buy1], { kind: 'delete', id: 'zzz' })).toEqual({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(check([buy1], { kind: 'edit', id: 'zzz', input: input('2026-10-12', 'buy', 100) }).ok).toBe(false);
  });
});

describe('checkLedgerChange on an already oversold ledger', () => {
  const bad = [buy1, t('s1', 2, '2026-10-16', 'sell', 500)];
  it('allows deleting the offending sell', () => {
    expect(check(bad, { kind: 'delete', id: 's1' }).ok).toBe(true);
  });
  it('allows an unrelated later change', () => {
    expect(check(bad, { kind: 'add', input: input('2026-10-20', 'buy', 100) }).ok).toBe(true);
  });
  it('rejects a change that creates an earlier oversell', () => {
    const r = check(bad, { kind: 'add', input: input('2026-10-14', 'sell', 400) });
    expect(r).toMatchObject({ ok: false, error: { code: 'OVERSELL_SELF' } });
  });
});

describe('OVERSELL params carry settlementDays', () => {
  it('uses the stored settlement days', () => {
    // T+3: a buy on Mon 2026-10-12 is not sellable on Wed 2026-10-14.
    const r = checkLedgerChange({
      transactions: [buy1],
      actions: [],
      settings: { ...settings, settlementDays: 3 },
      today,
      change: { kind: 'add', input: input('2026-10-14', 'sell', 100) },
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'OVERSELL_SELF', params: { settlementDays: 3 } } });
  });
});
