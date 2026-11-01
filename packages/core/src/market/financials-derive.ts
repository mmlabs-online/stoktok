import { roundDiv, toSafe } from '../money';
import { addQuarters } from './quarters';

/** Everything is already integer VND (see toVndAmount); `shares` is the period's share count exactly as the source gave it. */
export interface DeriveQuarterInput {
  period: string;
  /** Parent net income per quarter, integer VND. A quarter with no valid value is absent. */
  netIncomeByPeriod: ReadonlyMap<string, number>;
  /** Owner's equity including minority interests; undefined when missing. */
  equity: number | undefined;
  minority: number | undefined;
  shares: unknown;
}

export interface DerivedQuarter {
  /** TTM EPS in integer VND per share; undefined when any of the 4 quarters is missing. */
  eps?: number;
  /** Parent-equity book value per share in integer VND; undefined when equity or minority is missing. */
  bvps?: number;
  /** Set when nothing can be derived for the period. */
  reason?: 'missing_shares' | 'invalid_shares' | 'invalid_amount';
}

/**
 * ADR 0005: per-share values the source does not publish are derived here (R1/R2), rounded half away from zero.
 * EPS = sum of the 4 consecutive quarters' parent net income (the period and the 3 before it) / this period's shares
 * (all 4 quarters use the current share count, so a share issue restates the window). BVPS = (equity - minority) / shares.
 * Nothing is filled: a missing quarter or amount leaves that value undefined.
 */
export function deriveVciIqQuarter(input: DeriveQuarterInput): DerivedQuarter {
  const { shares } = input;
  if (shares === undefined || shares === null) return { reason: 'missing_shares' };
  if (typeof shares !== 'number' || !Number.isSafeInteger(shares) || shares <= 0) return { reason: 'invalid_shares' };
  const denom = BigInt(shares);

  const amounts: (number | undefined)[] = [input.equity, input.minority];
  for (let k = 0; k < 4; k++) amounts.push(input.netIncomeByPeriod.get(addQuarters(input.period, -k)));
  if (amounts.some((a) => a !== undefined && !Number.isSafeInteger(a))) return { reason: 'invalid_amount' };

  const out: DerivedQuarter = {};
  try {
    const quarters = amounts.slice(2);
    if (quarters.every((a) => a !== undefined)) {
      out.eps = toSafe(roundDiv(quarters.reduce<bigint>((s, a) => s + BigInt(a as number), 0n), denom));
    }
    if (input.equity !== undefined && input.minority !== undefined) {
      out.bvps = toSafe(roundDiv(BigInt(input.equity) - BigInt(input.minority), denom));
    }
  } catch {
    return { reason: 'invalid_amount' };
  }
  return out;
}
