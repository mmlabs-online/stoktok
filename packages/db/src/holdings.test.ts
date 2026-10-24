import { describe, expect, test } from 'vitest';
import { createFake } from '../test/fake-client';
import { listHeldSymbols } from './holdings';

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
const tx = (o: Record<string, unknown>) => ({
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
function fakeWith(txs: unknown[], settings: unknown = settingsRow) {
  const f = createFake();
  f.respond({ data: txs });
  f.respond({ data: [] });
  f.respond({ data: settings });
  return f;
}

describe('listHeldSymbols', () => {
  test('returns symbols with quantity > 0; sold-out symbol excluded', async () => {
    const f = fakeWith([
      tx({ id: 'a', seq: 1, symbol: 'FPT' }),
      tx({ id: 'b', seq: 2, symbol: 'VNM' }),
      tx({ id: 'c', seq: 3, symbol: 'VNM', side: 'sell', trade_date: '2026-02-10' }),
    ]);
    const out = await listHeldSymbols(f.db, '2026-03-01');
    expect(out).toEqual({ ok: true, value: ['FPT'] });
  });
  test('fee rate NULL does not throw', async () => {
    const f = fakeWith([tx({ id: 'a' })], { ...settingsRow, fee_rate_ppm: null });
    await expect(listHeldSymbols(f.db, '2026-03-01')).resolves.toEqual({ ok: true, value: ['FPT'] });
  });
  test('ledger error is returned as { ok: false }', async () => {
    const f = fakeWith([tx({ id: 'a', side: 'sell' })]);
    const out = await listHeldSymbols(f.db, '2026-03-01');
    expect(out.ok).toBe(false);
  });
});
