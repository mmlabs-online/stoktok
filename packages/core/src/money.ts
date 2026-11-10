/**
 * Money helpers. All money and prices are integer VND (R2).
 * Rounding is defined here once: half away from zero ("half-up").
 * Intermediate products use BigInt so large values stay exact.
 */
export const ROUNDING_MODE = 'half-up' as const;

export const PPM = 1_000_000;

export function isVnd(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertVnd(value: unknown, field: string): number {
  if (!isVnd(value)) {
    throw new RangeError(`${field} must be a safe integer (VND), got ${String(value)}`);
  }
  return value;
}

/** numer / denom rounded half away from zero. denom must be positive. */
export function roundDiv(numer: bigint, denom: bigint): bigint {
  if (denom <= 0n) throw new RangeError('denominator must be positive');
  const negative = numer < 0n;
  const abs = negative ? -numer : numer;
  const q = (2n * abs + denom) / (2n * denom);
  return negative ? -q : q;
}

/** numer / denom rounded up (toward +infinity). denom must be positive. Used where over-estimating is the safe side. */
export function ceilDiv(numer: bigint, denom: bigint): bigint {
  if (denom <= 0n) throw new RangeError('denominator must be positive');
  const q = numer / denom;
  return numer % denom > 0n ? q + 1n : q;
}

export function toSafe(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError('result exceeds safe integer range');
  return n;
}

/** round(a * b / c) computed exactly. */
export function mulDiv(a: number, b: number, c: number): number {
  assertVnd(a, 'a');
  assertVnd(b, 'b');
  assertVnd(c, 'c');
  return toSafe(roundDiv(BigInt(a) * BigInt(b), BigInt(c)));
}

/** amount * ratePpm / 1,000,000 (0.1% = 1000 ppm), rounded. */
export function applyRatePpm(amount: number, ratePpm: number): number {
  return mulDiv(amount, ratePpm, PPM);
}

/** Exact sum of integers; throws RangeError if any input or the result is not a safe integer. */
export function addVnd(...xs: number[]): number {
  let sum = 0n;
  for (const x of xs) sum += BigInt(assertVnd(x, 'amount'));
  return toSafe(sum);
}

/** floor(a / b) computed exactly. b must be a positive integer, a a non-negative-or-negative safe integer. */
export function floorDiv(a: number, b: number): number {
  assertVnd(a, 'a');
  assertVnd(b, 'b');
  if (b <= 0) throw new RangeError('denominator must be positive');
  const na = BigInt(a);
  const nb = BigInt(b);
  let q = na / nb;
  if (na % nb !== 0n && na < 0n) q -= 1n;
  return toSafe(q);
}
