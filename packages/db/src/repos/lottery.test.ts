import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import { DataError } from '../errors';
import { drawIdFromNo, drawNoFromId, lotteryDrawFromRow, lotteryTicketFromRow } from '../mappers';
import {
  createLotteryTicket,
  getLotteryDraw,
  listLotteryTickets,
  listPendingLotteryTickets,
  recordLotteryTicketResult,
  updateLotteryTicket,
  upsertLotteryDraws,
} from './lottery';

const megaRow = (over: Record<string, unknown> = {}) => ({
  game: 'mega645',
  draw_no: 123,
  draw_date: '2026-11-05',
  numbers: [1, 2, 3, 4, 5, 6],
  bonus: null,
  jackpot_vnd: '12000000000',
  jackpot_winners: 0,
  jackpot2_vnd: null,
  jackpot2_winners: null,
  source: 'vietlott',
  fetched_at: '2026-11-05T14:00:00Z',
  ...over,
});
const ticketRow = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  game: 'mega645',
  draw_no: 123,
  lines: [[1, 2, 3, 4, 5, 6]],
  cost_vnd: '10000',
  channel: 'sms',
  purchased_at: '2026-11-05T01:00:00Z',
  status: 'pending',
  prize_tier: null,
  gross_vnd: null,
  checked_at: null,
  raw_text: null,
  created_at: '2026-11-05T01:00:01Z',
  ...over,
});
const input = (over: Record<string, unknown> = {}) => ({
  gameId: 'mega645' as const,
  drawId: '123',
  lines: [[10, 11, 12, 13, 14, 15], [6, 5, 4, 3, 2, 1]],
  costVnd: 20000,
  channel: 'sms' as const,
  purchasedAt: '2026-11-05T01:00:00Z',
  rawText: null,
  ...over,
});
const draw = (n: number, over: Record<string, unknown> = {}) => ({
  gameId: 'mega645' as const,
  drawId: String(n),
  drawDate: '2026-11-05',
  numbers: [1, 2, 3, 4, 5, 6],
  source: 'vietlott',
  fetchedAt: '2026-11-05T14:00:00Z',
  ...over,
});

describe('draw id', () => {
  test("drawIdFromNo / drawNoFromId round-trip; '00123' → 123; '0', '-1', '1.5', 'abc', '' are rejected", () => {
    expect(drawNoFromId(drawIdFromNo(123))).toBe(123);
    expect(drawNoFromId('00123')).toBe(123);
    for (const bad of ['0', '-1', '1.5', 'abc', '']) expect(() => drawNoFromId(bad)).toThrow();
  });
});

describe('lotteryDrawFromRow', () => {
  test("maps a mega row: smallint numbers, bigint-string jackpot_vnd '12000000000' → pools.jackpot, no bonus", () => {
    const d = lotteryDrawFromRow(megaRow());
    expect(d).toEqual({
      gameId: 'mega645',
      drawId: '123',
      drawDate: '2026-11-05',
      numbers: [1, 2, 3, 4, 5, 6],
      pools: { jackpot: { amountVnd: 12000000000, winnerCount: 0 } },
      source: 'vietlott',
      fetchedAt: '2026-11-05T14:00:00Z',
    });
    expect('bonus' in d).toBe(false);
  });
  test('maps a power row: bonus, jackpot_* → jackpot1, jackpot2_* → jackpot2; null pool columns → pools omitted', () => {
    const d = lotteryDrawFromRow(
      megaRow({ game: 'power655', bonus: 9, jackpot2_vnd: '3000000000', jackpot2_winners: 1 }),
    );
    expect(d.bonus).toBe(9);
    expect(d.pools).toEqual({
      jackpot1: { amountVnd: 12000000000, winnerCount: 0 },
      jackpot2: { amountVnd: 3000000000, winnerCount: 1 },
    });
    const none = lotteryDrawFromRow(megaRow({ jackpot_vnd: null, jackpot_winners: null }));
    expect('pools' in none).toBe(false);
  });
  test('missing source or fetched_at → MAPPING (R4); unknown game → MAPPING', () => {
    expect(() => lotteryDrawFromRow(megaRow({ source: '' }))).toThrow(/source/);
    expect(() => lotteryDrawFromRow(megaRow({ fetched_at: null }))).toThrow(/fetched_at/);
    expect(() => lotteryDrawFromRow(megaRow({ game: 'keno' }))).toThrow(/game/);
  });
});

describe('upsertLotteryDraws', () => {
  test("uses onConflict 'game,draw_no', dedupes the input (last wins) and chunks", async () => {
    const f = createFake();
    f.respond({});
    f.respond({});
    const n = await upsertLotteryDraws(
      f.db,
      [draw(1), draw(2), draw(1, { numbers: [7, 8, 9, 10, 11, 12] })],
      { chunkSize: 1 },
    );
    expect(n).toBe(2);
    const ups = f.methods('upsert');
    expect(ups).toHaveLength(2);
    expect(ups[0]?.args[1]).toEqual({ onConflict: 'game,draw_no' });
    expect((ups[0]?.args[0] as { numbers: number[] }[])[0]?.numbers).toEqual([7, 8, 9, 10, 11, 12]);
    expect(f.methods('select')).toHaveLength(0);
  });
});

describe('getLotteryDraw', () => {
  test('filters game and draw_no with maybeSingle; no row → NOT_FOUND', async () => {
    const f = createFake();
    f.respond({ data: megaRow() });
    const d = await getLotteryDraw(f.db, 'mega645', '00123');
    expect(d.drawId).toBe('123');
    expect(f.methods('eq').map((c) => c.args)).toEqual([['game', 'mega645'], ['draw_no', 123]]);
    expect(f.methods('maybeSingle')).toHaveLength(1);
    f.respond({ data: null });
    await expect(getLotteryDraw(f.db, 'mega645', '5')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('createLotteryTicket', () => {
  test('canonicalises lines before insert', async () => {
    const f = createFake();
    f.respond({ data: ticketRow() });
    await createLotteryTicket(f.db, input());
    const payload = f.methods('insert')[0]?.args[0] as { lines: number[][]; draw_no: number };
    expect(payload.lines).toEqual([[1, 2, 3, 4, 5, 6], [10, 11, 12, 13, 14, 15]]);
    expect(payload.draw_no).toBe(123);
  });
  test('maps 23505 to CONFLICT', async () => {
    const f = createFake();
    f.respond({ error: { code: '23505' } });
    await expect(createLotteryTicket(f.db, input())).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  test('maps cost_vnd/gross_vnd bigint strings to numbers', async () => {
    const f = createFake();
    f.respond({
      data: ticketRow({ status: 'won', prize_tier: 'third', gross_vnd: '30000', checked_at: '2026-11-05T15:00:00Z' }),
    });
    const t = await createLotteryTicket(f.db, input());
    expect(t.costVnd).toBe(10000);
    expect(t.grossVnd).toBe(30000);
  });
  test('invalid draw id → VALIDATION', async () => {
    const f = createFake();
    const err = await createLotteryTicket(f.db, input({ drawId: 'abc' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataError);
    expect(err).toMatchObject({ code: 'VALIDATION' });
  });
});

describe('listLotteryTickets', () => {
  test('optional game/status/drawId filters become eq; order purchased_at desc, id asc', async () => {
    const f = createFake();
    f.respond({ data: [ticketRow()] });
    const out = await listLotteryTickets(f.db, { game: 'mega645', status: 'pending', drawId: '123' });
    expect(out).toHaveLength(1);
    expect(f.methods('eq').map((c) => c.args)).toEqual([['game', 'mega645'], ['status', 'pending'], ['draw_no', 123]]);
    expect(f.methods('order').map((c) => c.args)).toEqual([['purchased_at', { ascending: false }], ['id', { ascending: true }]]);
    f.respond({ data: [] });
    await listLotteryTickets(f.db);
    expect(f.methods('eq')).toHaveLength(3);
  });
});

describe('lotteryTicketFromRow', () => {
  test('lines that are not an array of integer arrays → MAPPING; bad status/channel/prize_tier → MAPPING', () => {
    expect(() => lotteryTicketFromRow(ticketRow({ lines: {} }) as never)).toThrow(/lines/);
    expect(() => lotteryTicketFromRow(ticketRow({ lines: [[1, 2.5]] }) as never)).toThrow(/lines/);
    expect(() => lotteryTicketFromRow(ticketRow({ lines: [1, 2] }) as never)).toThrow(/lines/);
    expect(() => lotteryTicketFromRow(ticketRow({ status: 'x' }) as never)).toThrow(/status/);
    expect(() => lotteryTicketFromRow(ticketRow({ channel: 'zalo' }) as never)).toThrow(/channel/);
    expect(() => lotteryTicketFromRow(ticketRow({ prize_tier: 'fourth' }) as never)).toThrow(/prize_tier/);
  });
});

describe('updateLotteryTicket', () => {
  test("sends the edited fields with status 'pending' and null result columns; no row → NOT_FOUND", async () => {
    const f = createFake();
    f.respond({ data: ticketRow() });
    await updateLotteryTicket(f.db, 'u1', input());
    expect(f.methods('update')[0]?.args[0]).toMatchObject({
      status: 'pending',
      prize_tier: null,
      gross_vnd: null,
      checked_at: null,
      lines: [[1, 2, 3, 4, 5, 6], [10, 11, 12, 13, 14, 15]],
    });
    expect(f.methods('eq')[0]?.args).toEqual(['id', 'u1']);
    f.respond({ data: null });
    await expect(updateLotteryTicket(f.db, 'u2', input())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('recordLotteryTicketResult', () => {
  test('won writes prize_tier and gross_vnd plus checked_at; lost writes gross_vnd 0 and prize_tier null; no row → NOT_FOUND', async () => {
    const f = createFake();
    f.respond({ data: ticketRow() });
    await recordLotteryTicketResult(f.db, 'u1', { status: 'won', prizeTier: 'third', grossVnd: 30000, checkedAt: 'T' });
    expect(f.methods('update')[0]?.args[0]).toEqual({ status: 'won', prize_tier: 'third', gross_vnd: 30000, checked_at: 'T' });
    f.respond({ data: ticketRow() });
    await recordLotteryTicketResult(f.db, 'u1', { status: 'lost', prizeTier: null, grossVnd: 0, checkedAt: 'T' });
    expect(f.methods('update')[1]?.args[0]).toEqual({ status: 'lost', prize_tier: null, gross_vnd: 0, checked_at: 'T' });
    f.respond({ data: null });
    await expect(
      recordLotteryTicketResult(f.db, 'x', { status: 'lost', prizeTier: null, grossVnd: 0, checkedAt: 'T' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('listPendingLotteryTickets', () => {
  test("filters status 'pending', game, draw_no", async () => {
    const f = createFake();
    f.respond({ data: [ticketRow()] });
    await listPendingLotteryTickets(f.db, 'mega645', '123');
    expect(f.methods('eq').map((c) => c.args)).toEqual([['status', 'pending'], ['game', 'mega645'], ['draw_no', 123]]);
  });
});
