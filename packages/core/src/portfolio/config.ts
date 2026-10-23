/** Portfolio defaults (R5): used when the user has not set a value. */

/** Concentration warning threshold: 20% in ppm. */
export const DEFAULT_CONCENTRATION_THRESHOLD_PPM = 200_000;

/** Minutes after 00:00 Vietnam time from which today's daily close is expected (18:00). */
export const DEFAULT_PRICE_CUTOFF_MINUTES_VN = 18 * 60;

/** A stored value in 0..1,000,000 is used as-is; NULL falls back to the default. */
export function resolveConcentrationThreshold(ppm: number | null): number {
  return ppm === null ? DEFAULT_CONCENTRATION_THRESHOLD_PPM : ppm;
}
