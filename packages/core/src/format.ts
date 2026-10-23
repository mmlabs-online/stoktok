/**
 * Display formatting (R1, R2). Pure string building, no Intl.NumberFormat,
 * so output is byte-exact across Node ICU builds. Vietnamese convention:
 * "." groups thousands, "," is the decimal separator, ASCII minus.
 */
import { assertVnd, roundDiv } from './money';

export const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';

export interface SignedOption {
  signed?: boolean;
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function sign(negative: boolean, isZero: boolean, signed: boolean | undefined): string {
  if (negative) return '-';
  return signed && !isZero ? '+' : '';
}

/** Splits a value in hundredths into "int,frac" with grouping. */
function formatHundredths(q: bigint): { text: string; negative: boolean; zero: boolean } {
  const negative = q < 0n;
  const abs = negative ? -q : q;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return { text: `${group((abs / 100n).toString())},${frac}`, negative, zero: abs === 0n };
}

export function formatVnd(vnd: number, opts: SignedOption & { symbol?: boolean } = {}): string {
  assertVnd(vnd, 'vnd');
  const abs = vnd < 0 ? -vnd : vnd;
  const body = group(BigInt(abs).toString());
  const text = `${sign(vnd < 0, vnd === 0, opts.signed)}${body}`;
  return opts.symbol === false ? text : `${text} ₫`;
}

/** Price in integer VND shown in thousand VND with 2 decimals (125400 -> "125,40"). */
export function formatPrice(vnd: number, opts: SignedOption = {}): string {
  assertVnd(vnd, 'vnd');
  const { text, negative, zero } = formatHundredths(roundDiv(BigInt(vnd), 10n));
  return `${sign(negative, zero, opts.signed)}${text}`;
}

/** Percent from integer ppm (1% = 10_000). */
export function formatPercent(ppm: number, opts: SignedOption = {}): string {
  assertVnd(ppm, 'ppm');
  const { text, negative, zero } = formatHundredths(roundDiv(BigInt(ppm), 100n));
  return `${sign(negative, zero, opts.signed)}${text}%`;
}

export function formatQuantity(qty: number): string {
  assertVnd(qty, 'quantity');
  const abs = qty < 0 ? -qty : qty;
  return `${qty < 0 ? '-' : ''}${group(BigInt(abs).toString())}`;
}

/** "YYYY-MM-DD" -> "DD/MM/YYYY". Pure string work. */
export function formatDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new RangeError(`invalid date: ${isoDate}`);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new RangeError(`invalid date: ${isoDate}`);
  }
  return `${m[3]}/${m[2]}/${m[1]}`;
}

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: VN_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** ISO instant -> "HH:mm dd/MM/yyyy" in Vietnam time. */
export function formatDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`invalid date-time: ${iso}`);
  const p: Record<string, string> = {};
  for (const part of dateTimeFormat.formatToParts(new Date(ms))) p[part.type] = part.value;
  return `${p.hour}:${p.minute} ${p.day}/${p.month}/${p.year}`;
}
