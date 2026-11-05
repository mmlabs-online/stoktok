import { addVnd, assertVnd, toSafe } from '../money';
import type { GameRules, LotteryError, LotteryTicket } from './types';

export type ValidateLineResult = { ok: true; line: number[] } | { ok: false; error: LotteryError };

/** C(n, k), exact via BigInt. */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let r = 1n;
  for (let i = 1; i <= kk; i++) r = (r * BigInt(n - kk + i)) / BigInt(i);
  return toSafe(r);
}

function fail(code: LotteryError['code'], message: string): { ok: false; error: LotteryError } {
  return { ok: false, error: { code, message } };
}

export function validateLine(rules: GameRules, numbers: number[]): ValidateLineResult {
  if (numbers.length === 0) return fail('wrong_count', 'line has no numbers');
  for (const n of numbers) {
    if (!Number.isInteger(n)) return fail('not_integer', `${String(n)} is not an integer`);
    if (n < rules.numberMin || n > rules.numberMax) return fail('out_of_range', `${n} is out of range`);
  }
  if (new Set(numbers).size !== numbers.length) return fail('duplicate_number', 'duplicate number in line');
  if (numbers.length !== rules.pickCount && !rules.systemSizes.includes(numbers.length)) {
    return fail('size_not_allowed', `line size ${numbers.length} is not allowed`);
  }
  return { ok: true, line: [...numbers].sort((a, b) => a - b) };
}

function* subsets(items: number[], k: number, start = 0, acc: number[] = []): Generator<number[]> {
  if (acc.length === k) {
    yield [...acc];
    return;
  }
  for (let i = start; i <= items.length - (k - acc.length); i++) {
    acc.push(items[i]!);
    yield* subsets(items, k, i + 1, acc);
    acc.pop();
  }
}

/** Expands a validated line to sorted pickCount-number combinations. Size 5 = the 5 picks plus any other number. */
export function expandLine(rules: GameRules, line: number[]): number[][] {
  const sorted = [...line].sort((a, b) => a - b);
  if (sorted.length < rules.pickCount) {
    const out: number[][] = [];
    for (let n = rules.numberMin; n <= rules.numberMax; n++) {
      if (!sorted.includes(n)) out.push([...sorted, n].sort((a, b) => a - b));
    }
    return out;
  }
  return [...subsets(sorted, rules.pickCount)];
}

function lineCombinationCount(rules: GameRules, size: number): number {
  if (size < rules.pickCount) return rules.numberMax - rules.numberMin + 1 - size;
  return choose(size, rules.pickCount);
}

/** Number of combinations of a ticket without expanding. Throws RangeError on an invalid ticket. */
export function ticketCombinationCount(rules: GameRules, ticket: LotteryTicket): number {
  const v = validateTicketLines(rules, ticket);
  if (!v.ok) throw new RangeError(`${v.error.code}: ${v.error.message}`);
  return addVnd(0, ...ticket.lines.map((l) => lineCombinationCount(rules, l.length)));
}

export function ticketCost(rules: GameRules, ticket: LotteryTicket): number {
  const count = ticketCombinationCount(rules, ticket);
  return toSafe(BigInt(count) * BigInt(assertVnd(rules.pricePerCombinationVnd, 'price')));
}

export function validateTicketLines(
  rules: GameRules,
  ticket: LotteryTicket,
): { ok: true; lines: number[][] } | { ok: false; error: LotteryError } {
  if (ticket.lines.length === 0) return fail('empty_ticket', 'ticket has no lines');
  const lines: number[][] = [];
  for (const l of ticket.lines) {
    const r = validateLine(rules, l);
    if (!r.ok) return r;
    lines.push(r.line);
  }
  return { ok: true, lines };
}
