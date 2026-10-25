export type ParseIntegerResult =
  | { ok: true; value: number }
  | { ok: false; code: 'REQUIRED' | 'NOT_INTEGER' | 'TOO_LARGE' };

const PLAIN_RE = /^\d+$/;
const GROUPED_RE = /^\d{1,3}(\.\d{3})+$/;

/**
 * Parses a non-negative whole number typed by the user ("125400" or "125.400", dot = thousands).
 * No floats: the range check is done on BigInt before converting (R2).
 */
export function parseIntegerInput(text: string, opts: { max: number }): ParseIntegerResult {
  const s = text.trim();
  if (s === '') return { ok: false, code: 'REQUIRED' };
  if (!PLAIN_RE.test(s) && !GROUPED_RE.test(s)) return { ok: false, code: 'NOT_INTEGER' };
  const big = BigInt(s.replaceAll('.', ''));
  if (big > BigInt(opts.max) || big > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, code: 'TOO_LARGE' };
  return { ok: true, value: Number(big) };
}

export type ParseRateResult =
  | { ok: true; ppm: number }
  | { ok: false; code: 'REQUIRED' | 'NEGATIVE' | 'INVALID' | 'TOO_PRECISE' | 'TOO_LARGE' };

const RATE_RE = /^(\d+)(?:[.,](\d+))?$/;

/**
 * Parses a percent typed by the user ("0,15" or "0.15" = 0.15%) into integer ppm (1% = 10,000 ppm).
 * Both "," and "." are decimal separators; at most 4 fraction digits (never rounded). BigInt only (R2).
 */
export function parseRatePercentInput(text: string, opts: { maxPpm: number }): ParseRateResult {
  const s = text.trim();
  if (s === '') return { ok: false, code: 'REQUIRED' };
  if (s.startsWith('-')) return { ok: false, code: 'NEGATIVE' };
  const m = RATE_RE.exec(s);
  if (!m) return { ok: false, code: 'INVALID' };
  const frac = m[2] ?? '';
  if (frac.length > 4) return { ok: false, code: 'TOO_PRECISE' };
  const big = BigInt(m[1] as string) * 10000n + BigInt(frac.padEnd(4, '0'));
  if (big > BigInt(opts.maxPpm)) return { ok: false, code: 'TOO_LARGE' };
  return { ok: true, ppm: Number(big) };
}

/** Integer ppm -> percent text with a comma decimal and no trailing zeros ("1500" -> "0,15"). Exact, no rounding. */
export function formatRatePercentInput(ppm: number): string {
  if (!Number.isSafeInteger(ppm) || ppm < 0) throw new RangeError(`ppm must be a non-negative safe integer: ${ppm}`);
  const big = BigInt(ppm);
  const int = (big / 10000n).toString();
  const frac = (big % 10000n).toString().padStart(4, '0').replace(/0+$/, '');
  return frac === '' ? int : `${int},${frac}`;
}
