import { describe, expect, test } from 'vitest';
import { drawIdFromNo, drawNoFromId, lotteryDrawFromRow, lotteryTicketFromRow } from '../mappers';
import type { PgDb } from '../pg/client';
import { createLotteryTicket, getLotteryDraw, listLotteryTickets, listPendingLotteryTickets, upsertLotteryDraws } from './lottery';

// Not a PgDb: any query attempt rejects with DB_ERROR, so a VALIDATION result proves that no query ran.
const noDb = {} as PgDb;

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


describe('input validation runs before any query', () => {
  const input = {
    gameId: 'mega645' as const,
    drawId: 'abc',
    lines: [[1, 2, 3, 4, 5, 6]],
    costVnd: 10000,
    channel: 'sms' as const,
    purchasedAt: '2026-11-05T01:00:00Z',
    rawText: null,
  };
  test('an invalid draw id is a VALIDATION error everywhere, with a non-handle db', async () => {
    await expect(createLotteryTicket(noDb, input)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(listLotteryTickets(noDb, { drawId: 'abc' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(listPendingLotteryTickets(noDb, 'mega645', '0')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(getLotteryDraw(noDb, 'mega645', '-1')).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  test('an empty draw list writes nothing', async () => {
    expect(await upsertLotteryDraws(noDb, [])).toBe(0);
  });
});
