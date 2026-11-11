import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { listHeldSymbols } from '../src/holdings';
import { loadLedger } from '../src/ledger';
import { kyselyOf } from '../src/pg/access';
import { createTransaction } from '../src/repos/transactions';
import { saveSettings } from '../src/repos/settings';
import { freshDb, type TestDb } from './harness';
import { DEFAULT_MARKET_SETTINGS } from '@stoktok/core';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

const settings = { ...DEFAULT_MARKET_SETTINGS, feeRatePpm: 0 as number | null, sellTaxRatePpm: 0, holidays: [] as string[] };
const tx = (symbol: string, tradeDate: string, side: 'buy' | 'sell' = 'buy', quantity = 100, price = 10000) => ({ tradeDate, symbol, side, quantity, price, fee: 0, tax: 0 });
const manual = { source: 'manual' as const };
const wipe = async () => {
  const k = kyselyOf(t.pgDb);
  await k.deleteFrom('transactions').execute();
  await k.deleteFrom('settings').execute();
};

describe('loadLedger', () => {
  test('replays stored transactions through core buildLedger', async () => {
    await wipe();
    await saveSettings(t.pgDb, settings);
    await createTransaction(t.pgDb, tx('FPT', '2026-01-05'), manual);
    const out = await loadLedger(t.pgDb, '2026-02-01');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.holdings.map((h) => [h.symbol, h.quantity])).toEqual([['FPT', 100]]);
  });

  test('same-day trades are replayed in (tradeDate, seq) order', async () => {
    await wipe();
    await saveSettings(t.pgDb, settings);
    await createTransaction(t.pgDb, tx('FPT', '2026-01-05'), manual);
    await createTransaction(t.pgDb, tx('FPT', '2026-01-20', 'buy', 100, 20000), manual);
    await createTransaction(t.pgDb, tx('FPT', '2026-01-20', 'sell', 100, 25000), manual);
    const out = await loadLedger(t.pgDb, '2026-02-01');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.holdings[0]?.quantity).toBe(100);
  });

  test('propagates NOT_CONFIGURED from settings', async () => {
    await wipe();
    await expect(loadLedger(t.pgDb, '2026-02-01')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});

describe('listHeldSymbols', () => {
  test('returns symbols with quantity > 0; sold-out symbol excluded', async () => {
    await wipe();
    await saveSettings(t.pgDb, settings);
    await createTransaction(t.pgDb, tx('FPT', '2026-01-05'), manual);
    await createTransaction(t.pgDb, tx('VNM', '2026-01-06'), manual);
    await createTransaction(t.pgDb, tx('VNM', '2026-02-10', 'sell'), manual);
    expect(await listHeldSymbols(t.pgDb, '2026-03-01')).toEqual({ ok: true, value: ['FPT'] });
  });

  test('fee rate NULL does not throw', async () => {
    await wipe();
    await saveSettings(t.pgDb, { ...settings, feeRatePpm: null }).catch(() => undefined);
    await createTransaction(t.pgDb, tx('FPT', '2026-01-05'), manual);
    await expect(listHeldSymbols(t.pgDb, '2026-03-01')).resolves.toEqual({ ok: true, value: ['FPT'] });
  });

  test('no settings row does not throw either; ledger error is returned as { ok: false }', async () => {
    await wipe();
    await createTransaction(t.pgDb, tx('FPT', '2026-01-05', 'sell'), manual);
    expect((await listHeldSymbols(t.pgDb, '2026-03-01')).ok).toBe(false);
  });
});
