import { addVnd } from '../money';
import { ticketCost } from './combinations';
import { LOTTERY_GAMES } from './config';
import type { CheckTicketOk, GameId, GameRules, LotteryTicket } from './types';

export interface GameSummary {
  ticketCount: number;
  pendingCount: number;
  spentVnd: number;
  wonGrossVnd: number;
  taxVnd: number;
  wonNetVnd: number;
  netResultVnd: number;
}

export function summarizeTickets(
  entries: { ticket: LotteryTicket; result?: CheckTicketOk }[],
  gamesRules: Record<GameId, GameRules> = LOTTERY_GAMES,
): Partial<Record<GameId, GameSummary>> {
  const out: Partial<Record<GameId, GameSummary>> = {};
  for (const { ticket, result } of entries) {
    if (result && (result.gameId !== ticket.gameId || result.drawId !== ticket.drawId)) {
      throw new RangeError('result does not belong to ticket');
    }
    const spent = ticketCost(gamesRules[ticket.gameId], ticket);
    const s = (out[ticket.gameId] ??= {
      ticketCount: 0,
      pendingCount: 0,
      spentVnd: 0,
      wonGrossVnd: 0,
      taxVnd: 0,
      wonNetVnd: 0,
      netResultVnd: 0,
    });
    s.ticketCount += 1;
    s.spentVnd = addVnd(s.spentVnd, spent);
    if (result) {
      s.wonGrossVnd = addVnd(s.wonGrossVnd, result.grossVnd);
      s.taxVnd = addVnd(s.taxVnd, result.taxVnd);
    } else {
      s.pendingCount += 1;
    }
    s.wonNetVnd = s.wonGrossVnd - s.taxVnd;
    s.netResultVnd = s.wonNetVnd - s.spentVnd;
  }
  return out;
}
