import { isValidDate } from '../calendar';
import { addVnd, floorDiv, isVnd } from '../money';
import { expandLine, ticketCombinationCount, ticketCost, validateTicketLines } from './combinations';
import { DEFAULT_LOTTERY_TAX_BASIS, LOTTERY_TAX_SCHEDULE } from './config';
import { prizeTax, taxRuleFor } from './tax';
import type {
  CheckTicketResult,
  DrawResult,
  GameRules,
  LotteryError,
  LotteryTicket,
  PrizeTier,
  TaxBasis,
  TaxRule,
  TierId,
  Win,
} from './types';

function err(code: LotteryError['code'], message: string): LotteryError {
  return { code, message };
}

export function validateDrawResult(rules: GameRules, draw: DrawResult): LotteryError | null {
  if (!isValidDate(draw.drawDate)) return err('invalid_draw_date', `invalid draw date ${draw.drawDate}`);
  const inRange = (n: number) => Number.isInteger(n) && n >= rules.numberMin && n <= rules.numberMax;
  if (draw.numbers.length !== rules.pickCount) return err('invalid_draw', 'wrong count of drawn numbers');
  if (!draw.numbers.every(inRange)) return err('invalid_draw', 'drawn number out of range');
  if (new Set(draw.numbers).size !== draw.numbers.length) return err('invalid_draw', 'duplicate drawn number');
  if (rules.hasBonus) {
    if (draw.bonus === undefined || !inRange(draw.bonus)) return err('invalid_draw', 'bonus number missing or invalid');
    if (draw.numbers.includes(draw.bonus)) return err('invalid_draw', 'bonus duplicates a drawn number');
  } else if (draw.bonus !== undefined) {
    return err('invalid_draw', 'game has no bonus number');
  }
  for (const pool of Object.values(draw.pools ?? {})) {
    if (!isVnd(pool.amountVnd) || pool.amountVnd < 0 || !isVnd(pool.winnerCount) || pool.winnerCount < 0) {
      return err('invalid_pool', 'pool amount and winner count must be safe integers >= 0');
    }
  }
  return null;
}

/** Highest tier hit by one combination, or null. */
export function checkCombination(rules: GameRules, combo: number[], draw: DrawResult): PrizeTier | null {
  const drawn = new Set(draw.numbers);
  const matches = combo.filter((n) => drawn.has(n)).length;
  const bonusHit = draw.bonus !== undefined && combo.includes(draw.bonus);
  for (const tier of rules.tiers) {
    if (tier.regularMatches === matches && (!tier.requiresBonus || bonusHit)) return tier;
  }
  return null;
}

export interface CheckTicketOptions {
  taxSchedule?: TaxRule[];
  taxBasis?: TaxBasis;
}

export function checkTicket(
  rules: GameRules,
  ticket: LotteryTicket,
  draw: DrawResult,
  opts: CheckTicketOptions = {},
): CheckTicketResult {
  const schedule = opts.taxSchedule ?? LOTTERY_TAX_SCHEDULE;
  const basis = opts.taxBasis ?? DEFAULT_LOTTERY_TAX_BASIS;
  if (ticket.gameId !== rules.gameId || draw.gameId !== rules.gameId) {
    return { ok: false, error: err('game_mismatch', 'ticket, draw and rules must be the same game') };
  }
  if (ticket.drawId !== draw.drawId) return { ok: false, error: err('draw_mismatch', 'ticket is for another draw') };
  const drawError = validateDrawResult(rules, draw);
  if (drawError) return { ok: false, error: drawError };
  const validated = validateTicketLines(rules, ticket);
  if (!validated.ok) return validated;

  const hits: { lineIndex: number; combo: number[]; tier: PrizeTier }[] = [];
  validated.lines.forEach((line, lineIndex) => {
    for (const combo of expandLine(rules, line)) {
      const tier = checkCombination(rules, combo, draw);
      if (tier) hits.push({ lineIndex, combo, tier });
    }
  });

  const tierCounts: Partial<Record<TierId, number>> = {};
  for (const h of hits) tierCounts[h.tier.id] = (tierCounts[h.tier.id] ?? 0) + 1;

  const wins: Win[] = [];
  for (const h of hits) {
    let grossVnd: number;
    if (h.tier.prize.kind === 'fixed') {
      grossVnd = h.tier.prize.amountVnd;
    } else {
      const pool = draw.pools?.[h.tier.id];
      if (!pool) return { ok: false, error: err('missing_pool_amount', `no pool amount for ${h.tier.id}`) };
      grossVnd = floorDiv(pool.amountVnd, Math.max(pool.winnerCount, tierCounts[h.tier.id] ?? 1, 1));
    }
    wins.push({ lineIndex: h.lineIndex, combo: h.combo, tierId: h.tier.id, grossVnd });
  }

  const taxRule = taxRuleFor(schedule, draw.drawDate);
  const grossVnd = addVnd(0, ...wins.map((w) => w.grossVnd));
  const taxVnd =
    basis === 'perTicket' ? prizeTax(grossVnd, taxRule) : addVnd(0, ...wins.map((w) => prizeTax(w.grossVnd, taxRule)));
  const topTier = hits.length > 0 ? hits.reduce((a, b) => (rules.tiers.indexOf(b.tier) < rules.tiers.indexOf(a.tier) ? b : a)).tier.id : null;

  return {
    ok: true,
    gameId: rules.gameId,
    drawId: ticket.drawId,
    costVnd: ticketCost(rules, ticket),
    combinationCount: ticketCombinationCount(rules, ticket),
    wins,
    tierCounts,
    grossVnd,
    taxVnd,
    netVnd: grossVnd - taxVnd,
    status: wins.length > 0 ? 'won' : 'lost',
    topTier,
    taxRule,
  };
}
