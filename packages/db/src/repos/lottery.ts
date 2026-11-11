/** Vietlott draws and tickets. Callers must call requireUser() first (R6); the worker uses its own db handle. */
import { RowMappingError, canonicalTicketLines } from '@stoktok/core';
import type { GameId, TierId } from '@stoktok/core';
import { DataError, found, mapRow } from '../errors';
import type { Ctx } from '../errors';
import { drawNoFromId, lotteryDrawFromRow, lotteryDrawToRow, lotteryTicketFromRow, lotteryTicketToRow } from '../mappers';
import type { LotteryStatus, LotteryTicketInput, StoredDrawResult, StoredLotteryTicket } from '../mappers';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';
import { jsonb, pickRows, upsertChunked } from '../pg/upsert';
import type { LotteryDrawRow, LotteryTicketRow } from '../rows';

const DRAW_COLS = ['game', 'draw_no', 'draw_date', 'numbers', 'bonus', 'jackpot_vnd', 'jackpot_winners', 'jackpot2_vnd', 'jackpot2_winners', 'source', 'fetched_at'] as const;
const TICKET_COLS = ['id', 'game', 'draw_no', 'lines', 'cost_vnd', 'channel', 'purchased_at', 'status', 'prize_tier', 'gross_vnd', 'checked_at', 'raw_text', 'created_at'] as const;

/** Caller input that fails to convert is a VALIDATION error, not a row mapping error. */
function input<T>(fn: () => T, ctx: Ctx): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RowMappingError) throw new DataError('VALIDATION', ctx.table, ctx.op, `invalid input (${e.field})`, undefined, { cause: e });
    throw e;
  }
}

const canonical = (t: LotteryTicketInput): LotteryTicketInput => ({ ...t, lines: canonicalTicketLines(t.lines) });

/** `lines` is jsonb: it is written only through jsonb(). */
const withLines = <T extends { lines: number[][] }>(row: T) => ({ ...row, lines: jsonb(row.lines) });

export async function createLotteryTicket(db: PgDb, ticket: LotteryTicketInput): Promise<StoredLotteryTicket> {
  const ctx = { table: 'lottery_tickets', op: 'create' };
  const payload = withLines(input(() => lotteryTicketToRow(canonical(ticket)), ctx));
  const row = await q(db, ctx, (k) => k.insertInto('lottery_tickets').values(payload).returning(TICKET_COLS).executeTakeFirstOrThrow());
  return mapRow(lotteryTicketFromRow, row as LotteryTicketRow, ctx);
}

export async function listLotteryTickets(
  db: PgDb,
  filter: { game?: GameId; status?: LotteryStatus; drawId?: string } = {},
): Promise<StoredLotteryTicket[]> {
  const ctx = { table: 'lottery_tickets', op: 'list' };
  const drawNo = filter.drawId !== undefined ? input(() => drawNoFromId(filter.drawId as string), ctx) : undefined;
  const rows = await q(db, ctx, (k) => {
    let b = k.selectFrom('lottery_tickets').select(TICKET_COLS);
    if (filter.game) b = b.where('game', '=', filter.game);
    if (filter.status) b = b.where('status', '=', filter.status);
    if (drawNo !== undefined) b = b.where('draw_no', '=', drawNo);
    return b.orderBy('purchased_at', 'desc').orderBy('id', 'asc').execute();
  });
  return rows.map((r) => mapRow(lotteryTicketFromRow, r as LotteryTicketRow, ctx));
}

export async function getLotteryTicket(db: PgDb, id: string): Promise<StoredLotteryTicket> {
  const ctx = { table: 'lottery_tickets', op: 'get' };
  const row = await q(db, ctx, (k) => k.selectFrom('lottery_tickets').select(TICKET_COLS).where('id', '=', id).executeTakeFirst());
  return mapRow(lotteryTicketFromRow, found(row, ctx) as LotteryTicketRow, ctx);
}

/** An edited ticket goes back to pending with its result cleared, so a stale win is never shown. */
export async function updateLotteryTicket(db: PgDb, id: string, ticket: LotteryTicketInput): Promise<StoredLotteryTicket> {
  const ctx = { table: 'lottery_tickets', op: 'update' };
  const payload = {
    ...withLines(input(() => lotteryTicketToRow(canonical(ticket)), ctx)),
    status: 'pending',
    prize_tier: null,
    gross_vnd: null,
    checked_at: null,
  };
  const row = await q(db, ctx, (k) => k.updateTable('lottery_tickets').set(payload).where('id', '=', id).returning(TICKET_COLS).executeTakeFirst());
  return mapRow(lotteryTicketFromRow, found(row, ctx) as LotteryTicketRow, ctx);
}

/** Writes only the result columns; values come from core `checkTicket` (`topTier`, `grossVnd`). */
export async function recordLotteryTicketResult(
  db: PgDb,
  id: string,
  result: { status: Exclude<LotteryStatus, 'pending'>; prizeTier: TierId | null; grossVnd: number; checkedAt: string },
): Promise<StoredLotteryTicket> {
  const ctx = { table: 'lottery_tickets', op: 'record_result' };
  const payload = {
    status: result.status,
    prize_tier: result.status === 'won' ? result.prizeTier : null,
    gross_vnd: result.status === 'won' ? result.grossVnd : 0,
    checked_at: result.checkedAt,
  };
  const row = await q(db, ctx, (k) => k.updateTable('lottery_tickets').set(payload).where('id', '=', id).returning(TICKET_COLS).executeTakeFirst());
  return mapRow(lotteryTicketFromRow, found(row, ctx) as LotteryTicketRow, ctx);
}

export async function listPendingLotteryTickets(db: PgDb, game: GameId, drawId: string): Promise<StoredLotteryTicket[]> {
  const ctx = { table: 'lottery_tickets', op: 'list_pending' };
  const drawNo = input(() => drawNoFromId(drawId), ctx);
  const rows = await q(db, ctx, (k) =>
    k.selectFrom('lottery_tickets').select(TICKET_COLS).where('status', '=', 'pending').where('game', '=', game).where('draw_no', '=', drawNo).execute(),
  );
  return rows.map((r) => mapRow(lotteryTicketFromRow, r as LotteryTicketRow, ctx));
}

/**
 * Idempotent last-write-wins upsert on (game, draw_no); a later duplicate in the input wins. Chunks run in one
 * transaction. Returns the number of unique rows written.
 */
export async function upsertLotteryDraws(
  db: PgDb,
  draws: readonly StoredDrawResult[],
  { chunkSize = 100 }: { chunkSize?: number } = {},
): Promise<number> {
  const ctx = { table: 'lottery_draws', op: 'upsert' };
  const byKey = new Map<string, ReturnType<typeof lotteryDrawToRow>>();
  for (const draw of draws) {
    const row = input(() => lotteryDrawToRow(draw), ctx);
    byKey.set(`${row.game}|${row.draw_no}`, row);
  }
  const unique = [...byKey.values()];
  await upsertChunked(db, ctx, 'lottery_draws', pickRows(unique, DRAW_COLS), ['game', 'draw_no'], chunkSize);
  return unique.length;
}

export async function getLotteryDraw(db: PgDb, game: GameId, drawId: string): Promise<StoredDrawResult> {
  const ctx = { table: 'lottery_draws', op: 'get' };
  const drawNo = input(() => drawNoFromId(drawId), ctx);
  const row = await q(db, ctx, (k) => k.selectFrom('lottery_draws').select(DRAW_COLS).where('game', '=', game).where('draw_no', '=', drawNo).executeTakeFirst());
  return mapRow(lotteryDrawFromRow, found(row, ctx) as LotteryDrawRow, ctx);
}
