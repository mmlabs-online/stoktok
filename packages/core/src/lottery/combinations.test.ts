import { describe, expect, it } from 'vitest';
import { choose, expandLine, ticketCombinationCount, ticketCost, validateLine, validateTicketLines } from './combinations';
import { MEGA_645, POWER_655 } from './config';

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('choose', () => {
  it('values', () => {
    expect(choose(7, 6)).toBe(7);
    expect(choose(18, 6)).toBe(18564);
    expect(choose(5, 0)).toBe(1);
    expect(choose(3, 6)).toBe(0);
  });
});

describe('expansion and cost', () => {
  it('regular line', () => {
    const t = { gameId: 'mega645' as const, drawId: 'd', lines: [range(6)] };
    expect(expandLine(MEGA_645, range(6))).toEqual([range(6)]);
    expect(ticketCost(MEGA_645, t)).toBe(10_000);
  });
  it('bao 7 -> 7 distinct sorted combos, cost 70,000', () => {
    const combos = expandLine(MEGA_645, range(7));
    expect(combos).toHaveLength(7);
    expect(new Set(combos.map((c) => c.join(','))).size).toBe(7);
    for (const c of combos) expect(c).toEqual([...c].sort((a, b) => a - b));
    expect(ticketCost(MEGA_645, { gameId: 'mega645', drawId: 'd', lines: [range(7)] })).toBe(70_000);
  });
  it('bao 5 Mega 40 / Power 50, containing all picks', () => {
    const mega = expandLine(MEGA_645, range(5));
    const power = expandLine(POWER_655, range(5));
    expect(mega).toHaveLength(40);
    expect(power).toHaveLength(50);
    for (const c of [...mega, ...power]) for (const n of range(5)) expect(c).toContain(n);
    expect(ticketCost(MEGA_645, { gameId: 'mega645', drawId: 'd', lines: [range(5)] })).toBe(400_000);
    expect(ticketCost(POWER_655, { gameId: 'power655', drawId: 'd', lines: [range(5)] })).toBe(500_000);
  });
  it('every allowed size: count matches expansion (up to bao 10)', () => {
    for (const size of MEGA_645.systemSizes) {
      const t = { gameId: 'mega645' as const, drawId: 'd', lines: [range(size)] };
      const count = ticketCombinationCount(MEGA_645, t);
      expect(count).toBe(size === 5 ? 40 : choose(size, 6));
      if (size <= 10) expect(expandLine(MEGA_645, range(size))).toHaveLength(count);
    }
  });
  it('multi-line cost is the sum', () => {
    expect(ticketCost(MEGA_645, { gameId: 'mega645', drawId: 'd', lines: [range(6), range(7)] })).toBe(80_000);
  });
});

describe('validation', () => {
  it.each([
    ['duplicate', MEGA_645, [1, 1, 2, 3, 4, 5], 'duplicate_number'],
    ['zero', MEGA_645, [0, 1, 2, 3, 4, 5], 'out_of_range'],
    ['46 Mega', MEGA_645, [1, 2, 3, 4, 5, 46], 'out_of_range'],
    ['56 Power', POWER_655, [1, 2, 3, 4, 5, 56], 'out_of_range'],
    ['non-integer', MEGA_645, [1, 2, 3, 4, 5, 6.5], 'not_integer'],
    ['size 4', MEGA_645, [1, 2, 3, 4], 'size_not_allowed'],
    ['size 19', MEGA_645, range(19), 'size_not_allowed'],
    ['empty', MEGA_645, [], 'wrong_count'],
  ] as const)('rejects %s', (_n, rules, line, code) => {
    const r = validateLine(rules, [...line]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(code);
  });
  it('rejects ticket with no lines', () => {
    const r = validateTicketLines(MEGA_645, { gameId: 'mega645', drawId: 'd', lines: [] });
    expect(r).toMatchObject({ ok: false, error: { code: 'empty_ticket' } });
  });
});

describe('ticketCost / ticketCombinationCount throw on invalid ticket', () => {
  const mk = (lines: number[][]) => ({ gameId: 'mega645' as const, drawId: 'd', lines });
  it.each([
    ['size 3', [[1, 2, 3]]],
    ['empty line', [[]]],
    ['duplicate', [[1, 2, 3, 4, 5, 5]]],
    ['no lines', []],
  ])('%s', (_n, lines) => {
    expect(() => ticketCost(MEGA_645, mk(lines))).toThrow(RangeError);
    expect(() => ticketCombinationCount(MEGA_645, mk(lines))).toThrow(RangeError);
  });
});
