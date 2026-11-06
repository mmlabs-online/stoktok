export type GameId = 'mega645' | 'power655';
export type TierId = 'jackpot' | 'jackpot1' | 'jackpot2' | 'first' | 'second' | 'third';
export type TaxBasis = 'perTicket' | 'perCombination';

export type PrizeAmount = { kind: 'fixed'; amountVnd: number } | { kind: 'pool' };

export interface PrizeTier {
  id: TierId;
  regularMatches: number;
  requiresBonus: boolean;
  prize: PrizeAmount;
}

export interface GameRules {
  gameId: GameId;
  pickCount: number;
  numberMin: number;
  numberMax: number;
  hasBonus: boolean;
  pricePerCombinationVnd: number;
  /** Allowed sizes of a system ("bao") line, besides a regular line of pickCount numbers. */
  systemSizes: number[];
  /** ISO weekdays, 1 = Monday .. 7 = Sunday. */
  drawWeekdays: number[];
  /** Ordered by rank, best first. */
  tiers: PrizeTier[];
}

export interface TaxRule {
  /** 'YYYY-MM-DD' draw date from which the rule applies; null = applies to all earlier draws. */
  effectiveFrom: string | null;
  thresholdVnd: number;
  ratePpm: number;
}

export interface LotteryTicket {
  gameId: GameId;
  drawId: string;
  /** Each line is a regular (pickCount numbers) or system ("bao") selection. */
  lines: number[][];
}

export interface PoolPrize {
  amountVnd: number;
  winnerCount: number;
}

export interface DrawResult {
  gameId: GameId;
  drawId: string;
  /** 'YYYY-MM-DD' */
  drawDate: string;
  numbers: number[];
  bonus?: number;
  pools?: Partial<Record<TierId, PoolPrize>>;
}

export type LotteryErrorCode =
  | 'wrong_count'
  | 'duplicate_number'
  | 'out_of_range'
  | 'not_integer'
  | 'size_not_allowed'
  | 'empty_ticket'
  | 'game_mismatch'
  | 'draw_mismatch'
  | 'invalid_draw'
  | 'invalid_draw_date'
  | 'invalid_pool'
  | 'missing_pool_amount';

export interface LotteryError {
  code: LotteryErrorCode;
  message: string;
}

export interface Win {
  lineIndex: number;
  combo: number[];
  tierId: TierId;
  grossVnd: number;
}

export interface CheckTicketOk {
  ok: true;
  gameId: GameId;
  drawId: string;
  costVnd: number;
  combinationCount: number;
  wins: Win[];
  tierCounts: Partial<Record<TierId, number>>;
  grossVnd: number;
  taxVnd: number;
  netVnd: number;
  status: 'won' | 'lost';
  topTier: TierId | null;
  taxRule: TaxRule;
}

export type CheckTicketResult = CheckTicketOk | { ok: false; error: LotteryError };
