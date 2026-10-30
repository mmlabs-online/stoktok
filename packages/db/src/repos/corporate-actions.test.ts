import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import { createCorporateAction, listCorporateActions } from './corporate-actions';

const base = { symbol: 'FPT', ex_date: '2026-03-01', record_date: null, pay_date: null, listing_date: null };
const cash = { ...base, id: 'c1', type: 'cash_dividend', amount_per_share: '1000', ratio_num: null, ratio_den: null };
const stock = { ...base, id: 's1', type: 'stock_dividend', amount_per_share: null, ratio_num: 20, ratio_den: 100 };

describe('corporate actions repo', () => {
  test('list orders ex_date, symbol, id and maps cash + stock dividends', async () => {
    const f = createFake();
    f.respond({ data: [cash, stock] });
    const out = await listCorporateActions(f.db);
    expect(f.methods('order').map((c) => c.args[0])).toEqual(['ex_date', 'symbol', 'id']);
    expect(out[0]).toMatchObject({ type: 'cash_dividend', amountPerShare: 1000 });
    expect(out[1]).toMatchObject({ type: 'stock_dividend', ratio: { held: 100, received: 20 } });
  });

  test('symbols filter uses .in; an empty list returns [] without a request', async () => {
    const f = createFake();
    f.respond({ data: [stock] });
    await listCorporateActions(f.db, { symbols: ['FPT', 'VNM'] });
    expect(f.methods('in')[0]?.args).toEqual(['symbol', ['FPT', 'VNM']]);
    const g = createFake();
    expect(await listCorporateActions(g.db, { symbols: [] })).toEqual([]);
    expect(g.methods('select')).toHaveLength(0);
  });

  test('create generates a uuid id and passes recordDate through', async () => {
    const f = createFake();
    f.respond({ data: cash });
    await createCorporateAction(
      f.db,
      { type: 'cash_dividend', symbol: 'FPT', exDate: '2026-03-01', amountPerShare: 1000 },
      { recordDate: '2026-02-28' },
    );
    const payload = f.methods('insert')[0]?.args[0] as Record<string, unknown>;
    expect(payload.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(payload.record_date).toBe('2026-02-28');
  });

  test('create maps pg 23505 to CONFLICT', async () => {
    const f = createFake();
    f.respond({ error: { code: '23505' } });
    await expect(
      createCorporateAction(f.db, { type: 'cash_dividend', symbol: 'FPT', exDate: '2026-03-01', amountPerShare: 1 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
