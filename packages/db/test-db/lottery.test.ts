import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { StoredDrawResult } from '../src/mappers';
import { DataError } from '../src/errors';
import { kyselyOf } from '../src/pg/access';
import {
  createLotteryTicket,
  getLotteryDraw,
  getLotteryTicket,
  listLotteryTickets,
  listPendingLotteryTickets,
  recordLotteryTicketResult,
  updateLotteryTicket,
  upsertLotteryDraws,
} from '../src/repos/lottery';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

const err = async (p: Promise<unknown>) => {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(DataError);
  return e as DataError;
};
const draw = (n: number, o: Partial<StoredDrawResult> = {}): StoredDrawResult => ({
  gameId: 'mega645',
  drawId: String(n),
  drawDate: '2026-11-05',
  numbers: [1, 2, 3, 4, 5, 6],
  pools: { jackpot: { amountVnd: 12_000_000_000, winnerCount: 0 } },
  source: 'vietlott',
  fetchedAt: '2026-11-05T14:00:00+00:00',
  ...o,
});
const ticket = (o: Record<string, unknown> = {}) => ({
  gameId: 'mega645' as const,
  drawId: '500',
  lines: [[10, 11, 12, 13, 14, 15]],
  costVnd: 10000,
  channel: 'manual' as const,
  purchasedAt: '2026-11-05T01:00:00+00:00',
  rawText: null as string | null,
  ...o,
});

describe('lottery draws', () => {
  test('draw replace nulls jackpots; numbers smallint[] → number[] (key game, draw_no)', async () => {
    await upsertLotteryDraws(t.pgDb, [draw(100), draw(101)]);
    expect(await getLotteryDraw(t.pgDb, 'mega645', '100')).toMatchObject({ numbers: [1, 2, 3, 4, 5, 6], pools: { jackpot: { amountVnd: 12_000_000_000, winnerCount: 0 } } });
    const { pools: _pools, ...noPools } = draw(100, { numbers: [6, 5, 4, 3, 2, 1], source: 'v2' });
    void _pools;
    await upsertLotteryDraws(t.pgDb, [noPools]);
    const replaced = await getLotteryDraw(t.pgDb, 'mega645', '100');
    expect(replaced).toMatchObject({ numbers: [6, 5, 4, 3, 2, 1], source: 'v2' });
    expect('pools' in replaced).toBe(false);
    expect(Array.isArray(replaced.numbers) && typeof replaced.numbers[0]).toBe('number');
    expect(await kyselyOf(t.pgDb).selectFrom('lottery_draws').select('game').where('draw_no', '=', 100).execute()).toHaveLength(1);
  });

  test('dedupe later wins and chunkSize splits writes; the power game keeps bonus and jackpot2', async () => {
    const n = await upsertLotteryDraws(t.pgDb, [draw(200), draw(200, { source: 'later' }), draw(201), draw(202)], { chunkSize: 2 });
    expect(n).toBe(3);
    expect((await getLotteryDraw(t.pgDb, 'mega645', '200')).source).toBe('later');
    await upsertLotteryDraws(t.pgDb, [
      draw(300, { gameId: 'power655', bonus: 9, pools: { jackpot1: { amountVnd: 3_000_000_000, winnerCount: 1 }, jackpot2: { amountVnd: 100, winnerCount: 2 } } }),
    ]);
    expect(await getLotteryDraw(t.pgDb, 'power655', '300')).toMatchObject({ bonus: 9, pools: { jackpot1: { winnerCount: 1 }, jackpot2: { amountVnd: 100 } } });
  });

  test('a missing draw → NOT_FOUND; an invalid draw id → VALIDATION', async () => {
    expect((await err(getLotteryDraw(t.pgDb, 'mega645', '9999'))).code).toBe('NOT_FOUND');
    expect((await err(getLotteryDraw(t.pgDb, 'mega645', 'abc'))).code).toBe('VALIDATION');
  });
});

describe('lottery tickets', () => {
  test('ticket lines round-trip as number[][]', async () => {
    const made = await createLotteryTicket(t.pgDb, ticket({ lines: [[15, 14, 13, 12, 11, 10], [1, 2, 3, 4, 5, 6]] }));
    expect(made.lines).toEqual([[1, 2, 3, 4, 5, 6], [10, 11, 12, 13, 14, 15]]);
    expect(made).toMatchObject({ costVnd: 10000, status: 'pending' });
    expect((await getLotteryTicket(t.pgDb, made.id)).lines).toEqual(made.lines);
    const upd = await updateLotteryTicket(t.pgDb, made.id, ticket({ lines: [[20, 21, 22, 23, 24, 25]] }));
    expect(upd.lines).toEqual([[20, 21, 22, 23, 24, 25]]);
  });

  test('duplicate raw_text differing only in whitespace → CONFLICT; sms identity duplicate → CONFLICT, other channel ok', async () => {
    await createLotteryTicket(t.pgDb, ticket({ drawId: '600', rawText: 'Mega 6/45  ve so 1' }));
    expect((await err(createLotteryTicket(t.pgDb, ticket({ drawId: '600', rawText: ' Mega 6/45 ve   so 1 ' })))).code).toBe('CONFLICT');
    const sms = ticket({ drawId: '601', channel: 'sms' });
    await createLotteryTicket(t.pgDb, sms);
    expect((await err(createLotteryTicket(t.pgDb, sms))).code).toBe('CONFLICT');
    await createLotteryTicket(t.pgDb, { ...sms, channel: 'momo' });
  });

  test('update resets to pending with result columns null; recordResult won gross 0 → VALIDATION', async () => {
    const made = await createLotteryTicket(t.pgDb, ticket({ drawId: '700' }));
    const won = await recordLotteryTicketResult(t.pgDb, made.id, { status: 'won', prizeTier: 'third', grossVnd: 30000, checkedAt: '2026-11-06T00:00:00+00:00' });
    expect(won).toMatchObject({ status: 'won', prizeTier: 'third', grossVnd: 30000 });
    const reset = await updateLotteryTicket(t.pgDb, made.id, ticket({ drawId: '700', costVnd: 20000 }));
    expect(reset).toMatchObject({ status: 'pending', costVnd: 20000 });
    expect(reset.prizeTier).toBeNull();
    expect(reset.grossVnd).toBeNull();
    expect((await err(recordLotteryTicketResult(t.pgDb, made.id, { status: 'won', prizeTier: 'third', grossVnd: 0, checkedAt: '2026-11-06T00:00:00+00:00' }))).code).toBe('VALIDATION');
    const lost = await recordLotteryTicketResult(t.pgDb, made.id, { status: 'lost', prizeTier: null, grossVnd: 0, checkedAt: '2026-11-06T00:00:00+00:00' });
    expect(lost).toMatchObject({ status: 'lost', grossVnd: 0 });
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await err(recordLotteryTicketResult(t.pgDb, id, { status: 'lost', prizeTier: null, grossVnd: 0, checkedAt: '2026-11-06T00:00:00+00:00' }))).code).toBe('NOT_FOUND');
    expect((await err(updateLotteryTicket(t.pgDb, id, ticket()))).code).toBe('NOT_FOUND');
    expect((await err(getLotteryTicket(t.pgDb, id))).code).toBe('NOT_FOUND');
  });

  test('listPending and drawId filter; invalid drawId → VALIDATION', async () => {
    const a = await createLotteryTicket(t.pgDb, ticket({ drawId: '800', purchasedAt: '2026-11-01T00:00:00+00:00' }));
    const b = await createLotteryTicket(t.pgDb, ticket({ drawId: '800', lines: [[1, 2, 3, 4, 5, 7]], purchasedAt: '2026-11-02T00:00:00+00:00' }));
    await createLotteryTicket(t.pgDb, ticket({ drawId: '801' }));
    await recordLotteryTicketResult(t.pgDb, a.id, { status: 'lost', prizeTier: null, grossVnd: 0, checkedAt: '2026-11-06T00:00:00+00:00' });
    expect((await listPendingLotteryTickets(t.pgDb, 'mega645', '800')).map((x) => x.id)).toEqual([b.id]);
    expect((await listLotteryTickets(t.pgDb, { drawId: '800' })).map((x) => x.id)).toEqual([b.id, a.id]);
    expect((await listLotteryTickets(t.pgDb, { drawId: '800', status: 'lost', game: 'mega645' })).map((x) => x.id)).toEqual([a.id]);
    expect((await err(listLotteryTickets(t.pgDb, { drawId: 'abc' }))).code).toBe('VALIDATION');
    expect((await err(listPendingLotteryTickets(t.pgDb, 'mega645', 'x'))).code).toBe('VALIDATION');
  });
});
