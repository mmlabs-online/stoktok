import type { GameId, GameRules, TaxBasis, TaxRule } from './types';

// Prize amounts and bao sizes below are defaults: verify against vietlott.vn before use (R5).
const SYSTEM_SIZES = [5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

export const MEGA_645: GameRules = {
  gameId: 'mega645',
  pickCount: 6,
  numberMin: 1,
  numberMax: 45,
  hasBonus: false,
  pricePerCombinationVnd: 10_000,
  systemSizes: SYSTEM_SIZES,
  drawWeekdays: [3, 5, 7],
  tiers: [
    { id: 'jackpot', regularMatches: 6, requiresBonus: false, prize: { kind: 'pool' } },
    { id: 'first', regularMatches: 5, requiresBonus: false, prize: { kind: 'fixed', amountVnd: 10_000_000 } },
    { id: 'second', regularMatches: 4, requiresBonus: false, prize: { kind: 'fixed', amountVnd: 300_000 } },
    { id: 'third', regularMatches: 3, requiresBonus: false, prize: { kind: 'fixed', amountVnd: 30_000 } },
  ],
};

export const POWER_655: GameRules = {
  gameId: 'power655',
  pickCount: 6,
  numberMin: 1,
  numberMax: 55,
  hasBonus: true,
  pricePerCombinationVnd: 10_000,
  systemSizes: SYSTEM_SIZES,
  drawWeekdays: [2, 4, 6],
  tiers: [
    { id: 'jackpot1', regularMatches: 6, requiresBonus: false, prize: { kind: 'pool' } },
    { id: 'jackpot2', regularMatches: 5, requiresBonus: true, prize: { kind: 'pool' } },
    { id: 'first', regularMatches: 5, requiresBonus: false, prize: { kind: 'fixed', amountVnd: 40_000_000 } },
    { id: 'second', regularMatches: 4, requiresBonus: false, prize: { kind: 'fixed', amountVnd: 500_000 } },
    { id: 'third', regularMatches: 3, requiresBonus: false, prize: { kind: 'fixed', amountVnd: 50_000 } },
  ],
};

export const LOTTERY_GAMES: Record<GameId, GameRules> = {
  mega645: MEGA_645,
  power655: POWER_655,
};

/** Sorted by effectiveFrom, earliest first. Law 109/2025/QH15 (Ming, 2026-11-05). */
export const LOTTERY_TAX_SCHEDULE: TaxRule[] = [
  { effectiveFrom: null, thresholdVnd: 10_000_000, ratePpm: 100_000 },
  { effectiveFrom: '2026-07-01', thresholdVnd: 20_000_000, ratePpm: 100_000 },
];

/** Prizes on one ticket in one draw are summed and taxed once (Ming, 2026-11-05). */
export const DEFAULT_LOTTERY_TAX_BASIS: TaxBasis = 'perTicket';
