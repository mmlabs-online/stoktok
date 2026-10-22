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

function toSafe(value: bigint): number {
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
