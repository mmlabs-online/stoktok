import { describe, expect, it } from 'vitest';
import { buildLedger } from './build-ledger';
import { DEFAULT_MARKET_SETTINGS } from './settings';
import type { CorporateAction, LedgerSettings, Transaction } from './types';

const settings: LedgerSettings = { ...DEFAULT_MARKET_SETTINGS, feeRatePpm: 1500 };

let n = 0;
function tx(p: Partial<Transaction> & Pick<Transaction, 'tradeDate' | 'side' | 'quantity' | 'price'>): Transaction {
  n += 1;
  return { id: `t${n}`, seq: n, symbol: 'FPT', ...p };
}
const buy = (tradeDate: string, quantity: number, price: number, extra: Partial<Transaction> = {}) =>
  tx({ tradeDate, side: 'buy', quantity, price, fee: 0, ...extra });
const sell = (tradeDate: string, quantity: number, price: number, extra: Partial<Transaction> = {}) =>
  tx({ tradeDate, side: 'sell', quantity, price, fee: 0, tax: 0, ...extra });

function run(
  txs: Transaction[],
  asOf: string,
  actions: CorporateAction[] = [],
  s: LedgerSettings = settings,
) {
  const r = buildLedger(txs, actions, s, asOf);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}
const hold = (v: ReturnType<typeof run>, symbol = 'FPT') => v.holdings.find((h) => h.symbol === symbol)!;

describe('buildLedger', () => {
  it('single buy then sell', () => {
    const v = run(
      [
        tx({ tradeDate: '2026-03-02', side: 'buy', quantity: 1000, price: 25000 }),
        tx({ tradeDate: '2026-03-04', side: 'sell', quantity: 1000, price: 27000 }),
      ],
      '2026-03-10',
    );
    // buy fee 37,500; sell fee 40,500, tax 27,000
    expect(v.realizations[0]).toMatchObject({
      proceedsNet: 26_932_500,
      costRemoved: 25_037_500,
      realizedPnl: 1_895_000,
    });
    expect(hold(v)).toMatchObject({
      quantity: 0,
      totalCost: 0,
      averageCost: null,
      realizedPnl: 1_895_000,
    });
    expect(v.lots).toEqual([]);
  });

  it('multiple lots with partial sell', () => {
    const v = run(
      [buy('2026-03-02', 1000, 20000), buy('2026-03-03', 500, 23000), sell('2026-03-06', 600, 25000)],
      '2026-03-06',
    );
    expect(v.realizations[0]).toMatchObject({ costRemoved: 12_600_000, realizedPnl: 2_400_000 });
    expect(hold(v)).toMatchObject({
      quantity: 900,
      sellableQuantity: 900,
      totalCost: 18_900_000,
      averageCost: 21000,
      realizedPnl: 2_400_000,
    });
    expect(v.lots.map((l) => l.quantityRemaining)).toEqual([400, 500]);
  });

  it('selling entire position removes all cost', () => {
    const v = run(
      [
        buy('2026-03-02', 7, 1001),
        buy('2026-03-02', 11, 1003),
        buy('2026-03-02', 13, 1007),
        sell('2026-03-04', 10, 1000),
        sell('2026-03-05', 21, 1000),
      ],
      '2026-03-05',
    );
    expect(v.realizations[0]!.costRemoved).toBe(10042);
    expect(v.realizations[0]!.costRemoved + v.realizations[1]!.costRemoved).toBe(31131);
    expect(hold(v).totalCost).toBe(0);
  });

  it('T+2 pending lot', () => {
    const txs = [buy('2026-03-02', 100, 10000)];
    const t1 = run(txs, '2026-03-03');
    expect(t1.lots[0]).toMatchObject({ status: 'pending', sellableFrom: '2026-03-04' });
    expect(hold(t1)).toMatchObject({ quantity: 100, sellableQuantity: 0 });
    const t2 = run(txs, '2026-03-04');
    expect(t2.lots[0]!.status).toBe('sellable');
    expect(hold(t2).sellableQuantity).toBe(100);
  });

  it('T+2 across weekend and holiday', () => {
    const thu = [buy('2026-03-05', 100, 10000)];
    expect(run(thu, '2026-03-05').lots[0]!.sellableFrom).toBe('2026-03-09');
    const withHoliday = { ...settings, holidays: ['2026-03-09'] };
    expect(run(thu, '2026-03-05', [], withHoliday).lots[0]!.sellableFrom).toBe('2026-03-10');
  });

  it('missing fee/tax filled from settings; entered fee/tax override', () => {
    const base = { quantity: 100, price: 10000 };
    const est = run(
      [
        tx({ tradeDate: '2026-03-02', side: 'buy', ...base }),
        tx({ tradeDate: '2026-03-04', side: 'sell', ...base }),
      ],
      '2026-03-04',
    );
    // buy fee 1,500 -> cost 1,001,500; sell fee 1,500 + tax 1,000 -> 997,500
    expect(est.realizations[0]).toMatchObject({ proceedsNet: 997_500, realizedPnl: -4000 });
    const entered = run([buy('2026-03-02', 100, 10000), sell('2026-03-04', 100, 10000)], '2026-03-04');
    expect(entered.realizations[0]!.proceedsNet).toBe(1_000_000);
  });

  it('events after asOf are ignored', () => {
    const v = run([buy('2026-03-02', 100, 10000), sell('2026-03-04', 100, 10000)], '2026-03-03');
    expect(hold(v).quantity).toBe(100);
    expect(v.realizations).toEqual([]);
  });

  describe('cash dividend', () => {
    const cash = (exDate: string, amountPerShare: number): CorporateAction => ({
      type: 'cash_dividend',
      id: `cd-${exDate}`,
      symbol: 'FPT',
      exDate,
      amountPerShare,
    });

    it('reduceCost (default)', () => {
      const v = run([buy('2026-03-02', 1000, 20000)], '2026-03-10', [cash('2026-03-10', 1000)]);
      // gross 1,000,000 - 5% withholding = 950,000
      expect(hold(v)).toMatchObject({
        totalCost: 19_050_000,
        averageCost: 19050,
        dividendCashNet: 950_000,
        realizedPnl: 0,
      });
    });

    it('income mode', () => {
      const s: LedgerSettings = { ...settings, cashDividendTreatment: 'income' };
      const v = run([buy('2026-03-02', 1000, 20000)], '2026-03-10', [cash('2026-03-10', 1000)], s);
      expect(hold(v)).toMatchObject({
        totalCost: 20_000_000,
        realizedPnl: 950_000,
        dividendCashNet: 950_000,
      });
    });

    it('entitles pending lot and excludes a buy on exDate', () => {
      const v = run(
        [buy('2026-03-02', 1000, 20000), buy('2026-03-03', 500, 20000)],
        '2026-03-03',
        [cash('2026-03-03', 1000)],
      );
      expect(hold(v).dividendCashNet).toBe(950_000);
      expect(v.lots.every((l) => l.status === 'pending' || l.sellableFrom <= '2026-03-03')).toBe(true);
    });

    it('larger than cost clamps totalCost to 0, excess goes to realized', () => {
      const v = run([buy('2026-03-02', 100, 1000)], '2026-03-10', [cash('2026-03-10', 2000)]);
      // net 190,000 vs cost 100,000
      expect(hold(v)).toMatchObject({ totalCost: 0, realizedPnl: 90_000, dividendCashNet: 190_000 });
    });
  });

  describe('stock dividend', () => {
    const stock = (held: number, received: number, listingDate?: string): CorporateAction => ({
      type: 'stock_dividend',
      id: 'sd1',
      symbol: 'FPT',
      exDate: '2026-03-10',
      ratio: { held, received },
      ...(listingDate ? { listingDate } : {}),
    });

    it('adds zero-cost lot, lowers average', () => {
      const v = run([buy('2026-03-02', 1000, 20000)], '2026-03-25', [stock(100, 20, '2026-03-20')]);
      expect(hold(v)).toMatchObject({ quantity: 1200, totalCost: 20_000_000, averageCost: 16667 });
      expect(v.lots[1]).toMatchObject({ source: 'stock_dividend', quantityRemaining: 200, costPerShare: 0 });
    });

    it('fractional shares dropped', () => {
      const v = run([buy('2026-03-02', 1010, 20000)], '2026-03-25', [stock(100, 15, '2026-03-20')]);
      expect(hold(v).quantity).toBe(1161);
    });

    it('lot pending until listingDate; falls back to exDate + settlement', () => {
      const txs = [buy('2026-03-02', 1000, 20000)];
      const early = run(txs, '2026-03-12', [stock(100, 20, '2026-03-20')]);
      expect(hold(early)).toMatchObject({ quantity: 1200, sellableQuantity: 1000 });
      expect(run(txs, '2026-03-20', [stock(100, 20, '2026-03-20')]).holdings[0]!.sellableQuantity).toBe(1200);
      const fallback = run(txs, '2026-03-12', [stock(100, 20)]);
      expect(fallback.lots[1]!.sellableFrom).toBe('2026-03-12');
      expect(hold(fallback).sellableQuantity).toBe(1200);
    });
  });

  describe('oversell', () => {
    it('returns OVERSELL error', () => {
      const t = sell('2026-03-04', 200, 10000);
      const r = buildLedger([buy('2026-03-02', 100, 10000), t], [], settings, '2026-03-04');
      expect(r).toEqual({
        ok: false,
        error: {
          code: 'OVERSELL',
          transactionId: t.id,
          symbol: 'FPT',
          date: '2026-03-04',
          requested: 200,
          sellable: 100,
        },
      });
    });

    it('sell of pending (T+1) shares is oversell', () => {
      const r = buildLedger(
        [buy('2026-03-02', 100, 10000), sell('2026-03-03', 100, 10000)],
        [],
        settings,
        '2026-03-04',
      );
      expect(r).toMatchObject({ ok: false, error: { code: 'OVERSELL', sellable: 0 } });
    });

    it('same-day buy then sell is oversell', () => {
      const r = buildLedger(
        [buy('2026-03-02', 100, 10000), sell('2026-03-02', 100, 10000)],
        [],
        settings,
        '2026-03-04',
      );
      expect(r).toMatchObject({ ok: false, error: { code: 'OVERSELL', sellable: 0 } });
    });
  });

  it('rejects non-integer money (INVALID_INPUT)', () => {
    const t = buy('2026-03-02', 100, 1.5);
    expect(buildLedger([t], [], settings, '2026-03-04')).toEqual({
      ok: false,
      error: { code: 'INVALID_INPUT', id: t.id, field: 'price', message: 'must be integer >= 0' },
    });
  });

  it('overflow-sized values stay exact or are rejected, never silently wrong', () => {
    const r = buildLedger([buy('2026-03-02', 100_000_000_000, 1_000_000_000)], [], settings, '2026-03-04');
    expect(r.ok).toBe(false);
  });

  it('same-date ordering uses seq then id', () => {
    const a = buy('2026-03-02', 10, 1000, { id: 'b', seq: 2 });
    const b = buy('2026-03-02', 20, 1000, { id: 'a', seq: 2 });
    const c = buy('2026-03-02', 30, 1000, { id: 'z', seq: 1 });
    const v = run([a, b, c], '2026-03-02');
    expect(v.lots.map((l) => l.sourceId)).toEqual(['z', 'a', 'b']);
  });

  it('does not mutate inputs', () => {
    const txs = Object.freeze([
      Object.freeze(buy('2026-03-02', 100, 10000)),
      Object.freeze(sell('2026-03-04', 50, 10000)),
    ]);
    const snapshot = JSON.stringify(txs);
    run(txs as Transaction[], '2026-03-05');
    expect(JSON.stringify(txs)).toBe(snapshot);
  });
});
