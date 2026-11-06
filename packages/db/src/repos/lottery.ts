/** Vietlott draws and tickets. Callers must call requireUser() first (R6); the worker uses the service client directly. */
import { RowMappingError, canonicalTicketLines } from '@stoktok/core';
import type { GameId, TierId } from '@stoktok/core';
import type { Db } from '../client';
import { DataError, mapRow, unwrap, unwrapFound } from '../errors';
import type { Ctx } from '../errors';
import { drawNoFromId, lotteryDrawFromRow, lotteryDrawToRow, lotteryTicketFromRow, lotteryTicketToRow } from '../mappers';
import type { LotteryStatus, LotteryTicketInput, StoredDrawResult, StoredLotteryTicket } from '../mappers';
import type { LotteryDrawRow, LotteryTicketRow } from '../rows';

const DRAW_COLS = 'game,draw_no,draw_date,numbers,bonus,jackpot_vnd,jackpot_winners,jackpot2_vnd,jackpot2_winners,source,fetched_at';
const TICKET_COLS = 'id,game,draw_no,lines,cost_vnd,channel,purchased_at,status,prize_tier,gross_vnd,checked_at,raw_text,created_at';

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

export async function createLotteryTicket(db: Db, ticket: LotteryTicketInput): Promise<StoredLotteryTicket> {
  const ctx = { table: 'lottery_tickets', op: 'create' };
  const payload = input(() => lotteryTicketToRow(canonical(ticket)), ctx);
  const row = unwrap<LotteryTicketRow>(await db.from('lottery_tickets').insert(payload).select(TICKET_COLS).single(), ctx);
  return mapRow(lotteryTicketFromRow, row, ctx);
}

export async function listLotteryTickets(
  db: Db,
  filter: { game?: GameId; status?: LotteryStatus; drawId?: string } = {},
): Promise<StoredLotteryTicket[]> {
  const ctx = { table: 'lottery_tickets', op: 'list' };
  let q = db.from('lottery_tickets').select(TICKET_COLS);
  if (filter.game) q = q.eq('game', filter.game);
  if (filter.status) q = q.eq('status', filter.status);
  if (filter.drawId !== undefined) q = q.eq('draw_no', input(() => drawNoFromId(filter.drawId as string), ctx));
  const rows = unwrap<LotteryTicketRow[]>(
    await q.order('purchased_at', { ascending: false }).order('id', { ascending: true }),
    ctx,
  );
  return rows.map((r) => mapRow(lotteryTicketFromRow, r, ctx));
}

export async function getLotteryTicket(db: Db, id: string): Promise<StoredLotteryTicket> {
  const ctx = { table: 'lottery_tickets', op: 'get' };
  const row = unwrapFound<LotteryTicketRow>(await db.from('lottery_tickets').select(TICKET_COLS).eq('id', id).maybeSingle(), ctx);
  return mapRow(lotteryTicketFromRow, row, ctx);
}

/** An edited ticket goes back to pending with its result cleared, so a stale win is never shown. */
export async function updateLotteryTicket(db: Db, id: string, ticket: LotteryTicketInput): Promise<StoredLotteryTicket> {
  const ctx = { table: 'lottery_tickets', op: 'update' };
  const payload = {
    ...input(() => lotteryTicketToRow(canonical(ticket)), ctx),
    status: 'pending',
    prize_tier: null,
    gross_vnd: null,
    checked_at: null,
  };
  const row = unwrapFound<LotteryTicketRow>(
    await db.from('lottery_tickets').update(payload).eq('id', id).select(TICKET_COLS).maybeSingle(),
    ctx,
  );
  return mapRow(lotteryTicketFromRow, row, ctx);
}

/** Writes only the result columns; values come from core `checkTicket` (`topTier`, `grossVnd`). */
export async function recordLotteryTicketResult(
  db: Db,
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
  const row = unwrapFound<LotteryTicketRow>(
    await db.from('lottery_tickets').update(payload).eq('id', id).select(TICKET_COLS).maybeSingle(),
    ctx,
  );
  return mapRow(lotteryTicketFromRow, row, ctx);
}

export async function listPendingLotteryTickets(db: Db, game: GameId, drawId: string): Promise<StoredLotteryTicket[]> {
  const ctx = { table: 'lottery_tickets', op: 'list_pending' };
  const drawNo = input(() => drawNoFromId(drawId), ctx);
  const rows = unwrap<LotteryTicketRow[]>(
    await db.from('lottery_tickets').select(TICKET_COLS).eq('status', 'pending').eq('game', game).eq('draw_no', drawNo),
    ctx,
  );
  return rows.map((r) => mapRow(lotteryTicketFromRow, r, ctx));
}

/**
 * Idempotent last-write-wins upsert on (game, draw_no); a later duplicate in the input wins. Sequential chunks,
 * no `.select()`. Returns the number of rows sent.
 */
export async function upsertLotteryDraws(
  db: Db,
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
  for (let i = 0; i < unique.length; i += chunkSize) {
    const res = await db.from('lottery_draws').upsert(unique.slice(i, i + chunkSize), { onConflict: 'game,draw_no' });
    if (res.error) unwrap(res, ctx);
  }
  return unique.length;
}

export async function getLotteryDraw(db: Db, game: GameId, drawId: string): Promise<StoredDrawResult> {
  const ctx = { table: 'lottery_draws', op: 'get' };
  const drawNo = input(() => drawNoFromId(drawId), ctx);
  const row = unwrapFound<LotteryDrawRow>(
    await db.from('lottery_draws').select(DRAW_COLS).eq('game', game).eq('draw_no', drawNo).maybeSingle(),
    ctx,
  );
  return mapRow(lotteryDrawFromRow, row, ctx);
}
