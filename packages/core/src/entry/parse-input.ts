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
