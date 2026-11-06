import { describe, expect, it } from 'vitest';
import { checkTicket } from './check';
import { DEFAULT_LOTTERY_TAX_BASIS, LOTTERY_TAX_SCHEDULE, MEGA_645, POWER_655 } from './config';
import { validateLine } from './combinations';
import type { DrawResult, GameRules, LotteryTicket } from './types';

describe('game configs', () => {
  it('Mega 6/45 rules', () => {
    expect(MEGA_645).toMatchObject({ numberMin: 1, numberMax: 45, pickCount: 6, hasBonus: false, pricePerCombinationVnd: 10_000, drawWeekdays: [3, 5, 7] });
    expect(MEGA_645.tiers.map((t) => t.id)).toEqual(['jackpot', 'first', 'second', 'third']);
  });
  it('Power 6/55 rules', () => {
    expect(POWER_655).toMatchObject({ numberMin: 1, numberMax: 55, pickCount: 6, hasBonus: true, pricePerCombinationVnd: 10_000, drawWeekdays: [2, 4, 6] });
    expect(POWER_655.tiers.map((t) => t.id)).toEqual(['jackpot1', 'jackpot2', 'first', 'second', 'third']);
  });
  it('tiers ordered by rank; fixed amounts are safe integers', () => {
    for (const g of [MEGA_645, POWER_655]) {
      const ranks = g.tiers.map((t) => t.regularMatches * 2 + (t.requiresBonus ? 1 : 0));
      expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
      for (const t of g.tiers) if (t.prize.kind === 'fixed') expect(Number.isSafeInteger(t.prize.amountVnd)).toBe(true);
    }
  });
  it('tax schedule', () => {
    expect(LOTTERY_TAX_SCHEDULE).toEqual([
      { effectiveFrom: null, thresholdVnd: 10_000_000, ratePpm: 100_000 },
      { effectiveFrom: '2026-07-01', thresholdVnd: 20_000_000, ratePpm: 100_000 },
    ]);
    expect(DEFAULT_LOTTERY_TAX_BASIS).toBe('perTicket');
  });
  it('custom rules object changes the outcome', () => {
    const custom: GameRules = {
      ...MEGA_645,
      numberMax: 40,
      tiers: MEGA_645.tiers.map((t) => (t.id === 'third' ? { ...t, prize: { kind: 'fixed' as const, amountVnd: 99_000 } } : t)),
    };
    expect(validateLine(custom, [1, 2, 3, 4, 5, 41]).ok).toBe(false);
    expect(validateLine(MEGA_645, [1, 2, 3, 4, 5, 41]).ok).toBe(true);
    const ticket: LotteryTicket = { gameId: 'mega645', drawId: 'd', lines: [[1, 2, 3, 20, 21, 22]] };
    const draw: DrawResult = { gameId: 'mega645', drawId: 'd', drawDate: '2026-08-01', numbers: [1, 2, 3, 4, 5, 6] };
    const r = checkTicket(custom, ticket, draw, { taxSchedule: [{ effectiveFrom: null, thresholdVnd: 50_000, ratePpm: 100_000 }] });
    expect(r).toMatchObject({ ok: true, grossVnd: 99_000, taxVnd: 4_900 });
  });
});
