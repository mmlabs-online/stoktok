import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DataError } from '../src/errors';
import { createCorporateAction, deleteCorporateAction, listCorporateActions, updateCorporateAction } from '../src/repos/corporate-actions';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

const cash = (symbol: string, exDate: string, payDate?: string) => ({
  type: 'cash_dividend' as const,
  symbol,
  exDate,
  amountPerShare: 1500,
  ...(payDate ? { payDate } : {}),
});
const split = (symbol: string, exDate: string) => ({ type: 'stock_dividend' as const, symbol, exDate, ratio: { held: 100, received: 20 } });
const err = async (p: Promise<unknown>) => {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(DataError);
  return e as DataError;
};

describe('corporate actions repo', () => {
  test('update is a full replace (cash dividend → split clears amount_per_share, pay_date, record_date)', async () => {
    const made = await createCorporateAction(t.pgDb, cash('REP', '2026-04-01', '2026-04-20'), { recordDate: '2026-03-31' });
    expect(made).toMatchObject({ type: 'cash_dividend', amountPerShare: 1500, payDate: '2026-04-20' });
    const upd = await updateCorporateAction(t.pgDb, made.id, split('REP', '2026-04-01'));
    expect(upd).toMatchObject({ id: made.id, type: 'stock_dividend', ratio: { held: 100, received: 20 } });
    expect(upd).not.toHaveProperty('amountPerShare');
    expect(upd).not.toHaveProperty('payDate');
    const [listed] = await listCorporateActions(t.pgDb, { symbol: 'REP' });
    expect(listed).toEqual(upd);
  });

  test('duplicate (symbol, type, ex_date) on create and update → CONFLICT', async () => {
    await createCorporateAction(t.pgDb, cash('DUP', '2026-05-01'));
    const other = await createCorporateAction(t.pgDb, cash('DUP', '2026-06-01'));
    expect(await err(createCorporateAction(t.pgDb, cash('DUP', '2026-05-01')))).toMatchObject({ code: 'CONFLICT' });
    expect(await err(updateCorporateAction(t.pgDb, other.id, cash('DUP', '2026-05-01')))).toMatchObject({ code: 'CONFLICT' });
  });

  test('ordering ex_date, symbol, id; symbols: [] → []', async () => {
    await createCorporateAction(t.pgDb, cash('OB', '2026-07-02'));
    await createCorporateAction(t.pgDb, cash('OA', '2026-07-02'));
    await createCorporateAction(t.pgDb, cash('OC', '2026-07-01'));
    const rows = await listCorporateActions(t.pgDb, { symbols: ['OA', 'OB', 'OC'] });
    expect(rows.map((r) => r.symbol)).toEqual(['OC', 'OA', 'OB']);
    expect(await listCorporateActions(t.pgDb, { symbols: [] })).toEqual([]);
  });

  test('delete removes the row; unknown id → NOT_FOUND; update unknown → NOT_FOUND', async () => {
    const made = await createCorporateAction(t.pgDb, cash('DEL', '2026-08-01'));
    await deleteCorporateAction(t.pgDb, made.id);
    expect(await err(deleteCorporateAction(t.pgDb, made.id))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await err(updateCorporateAction(t.pgDb, made.id, cash('DEL', '2026-08-01')))).toMatchObject({ code: 'NOT_FOUND' });
  });
});
