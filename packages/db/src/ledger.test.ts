import * as core from '@stoktok/core';
import { describe, expect, test, vi } from 'vitest';
import { createFake } from '../test/fake-client';
import { loadLedger } from './ledger';

const settingsRow = {
  id: 1,
  fee_rate_ppm: 0,
  sell_tax_rate_ppm: 0,
  dividend_withholding_rate_ppm: 0,
  settlement_days: 2,
  holidays: [],
  cash_dividend_treatment: 'reduceCost',
  cost_method: 'WAC',
};
const txRow = (o: Record<string, unknown>) => ({
  id: 'x',
  seq: 1,
  trade_date: '2026-01-05',
  symbol: 'FPT',
  side: 'buy',
  quantity: 100,
  price: 10000,
  fee: 0,
  tax: 0,
  source: 'manual',
  import_batch_id: null,
  external_ref: null,
  ...o,
});

function fakeWith(txs: unknown[]) {
  const f = createFake();
  f.respond({ data: txs });
  f.respond({ data: [] });
  f.respond({ data: settingsRow });
  return f;
}

describe('loadLedger', () => {
  test('passes mapped inputs to buildLedger and returns its Result unchanged', async () => {
    const sentinel: core.Result<core.Ledger> = { ok: true, value: { lots: [], holdings: [], realizations: [] } };
    const spy = vi.spyOn(core, 'buildLedger').mockReturnValue(sentinel);
    try {
      const f = fakeWith([txRow({ id: 'a' })]);
      const out = await loadLedger(f.db, '2026-02-01');
      expect(out).toBe(sentinel);
      const [txs, cas, settings, asOf] = spy.mock.calls[0] ?? [];
      expect(txs?.[0]).toMatchObject({ id: 'a', tradeDate: '2026-01-05', quantity: 100 });
      expect(cas).toEqual([]);
      expect(settings).toMatchObject({ feeRatePpm: 0, settlementDays: 2 });
      expect(asOf).toBe('2026-02-01');
    } finally {
      spy.mockRestore();
    }
  });

  test('same-day trades reach buildLedger in (tradeDate, seq) order', async () => {
    const buy0 = txRow({ id: 'b0', seq: 1, trade_date: '2026-01-05' });
    const buy = txRow({ id: 'b3', seq: 3, trade_date: '2026-01-20', quantity: 100, price: 20000 });
    const sell = txRow({ id: 's2', seq: 2, trade_date: '2026-01-20', side: 'sell', quantity: 100, price: 25000 });
    const f = fakeWith([buy0, buy, sell]);
    const out = await loadLedger(f.db, '2026-02-01');
    const ordered = [buy0, sell, buy].map((r) => core.transactionFromRow(r as never));
    const settings = core.settingsFromRow(settingsRow as never);
    expect(out.ok).toBe(true);
    expect(out).toEqual(core.buildLedger(ordered, [], settings, '2026-02-01'));
  });

  test('propagates DataError NOT_CONFIGURED from settings', async () => {
    const f = createFake();
    f.respond({ data: [] });
    f.respond({ data: [] });
    f.respond({ data: null });
    await expect(loadLedger(f.db, '2026-02-01')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  test.todo('no query before auth (STK-004)');
});
