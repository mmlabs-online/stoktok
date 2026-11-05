import { describe, expect, it } from 'vitest';
import { checkTicket } from './check';
import { MEGA_645 } from './config';
import { summarizeTickets } from './summary';
import type { DrawResult, LotteryTicket } from './types';

const draw: DrawResult = { gameId: 'mega645', drawId: 'M1', drawDate: '2026-08-01', numbers: [1, 2, 3, 4, 5, 6] };
const mk = (...lines: number[][]): LotteryTicket => ({ gameId: 'mega645', drawId: 'M1', lines });
const entry = (t: LotteryTicket) => {
  const r = checkTicket(MEGA_645, t, draw);
  if (!r.ok) throw new Error('unexpected');
  return { ticket: t, result: r };
};

describe('summarizeTickets', () => {
  it('totals per game', () => {
    const s = summarizeTickets([entry(mk([1, 2, 3, 4, 5, 40])), entry(mk([40, 41, 42, 43, 44, 45]))]);
    expect(s.mega645).toEqual({ ticketCount: 2, pendingCount: 0, spentVnd: 20_000, wonGrossVnd: 10_000_000, taxVnd: 0, wonNetVnd: 10_000_000, netResultVnd: 9_980_000 });
  });
  it('pending ticket counts as spent but not won', () => {
    const s = summarizeTickets([{ ticket: mk([1, 2, 3, 4, 5, 6, 7]) }]);
    expect(s.mega645).toMatchObject({ ticketCount: 1, pendingCount: 1, spentVnd: 70_000, wonGrossVnd: 0, netResultVnd: -70_000 });
  });
  it('games kept separate; empty list gives empty result', () => {
    expect(summarizeTickets([])).toEqual({});
    const s = summarizeTickets([{ ticket: mk([1, 2, 3, 4, 5, 6]) }, { ticket: { gameId: 'power655', drawId: 'P1', lines: [[1, 2, 3, 4, 5, 6]] } }]);
    expect(Object.keys(s).sort()).toEqual(['mega645', 'power655']);
  });
  it('net result negative when losing', () => {
    const s = summarizeTickets([entry(mk([40, 41, 42, 43, 44, 45]))]);
    expect(s.mega645?.netResultVnd).toBe(-10_000);
  });
});

describe('summarizeTickets validation', () => {
  it('rejects invalid pending ticket', () => {
    expect(() => summarizeTickets([{ ticket: mk([1, 2, 3]) }])).toThrow(RangeError);
  });
  it('rejects result for another ticket', () => {
    const e = entry(mk([40, 41, 42, 43, 44, 45]));
    expect(() => summarizeTickets([{ ticket: { ...e.ticket, drawId: 'M2' }, result: e.result }])).toThrow(RangeError);
    expect(() => summarizeTickets([{ ticket: { ...e.ticket, gameId: 'power655' }, result: e.result }])).toThrow(RangeError);
  });
});
