import { describe, expect, it } from 'vitest';
import { checkCombination, checkTicket } from './check';
import { MEGA_645, POWER_655 } from './config';
import type { DrawResult, LotteryTicket, TierId } from './types';

const megaDraw = (over: Partial<DrawResult> = {}): DrawResult => ({
  gameId: 'mega645',
  drawId: 'M1',
  drawDate: '2026-08-01',
  numbers: [1, 2, 3, 4, 5, 6],
  pools: { jackpot: { amountVnd: 30_000_000_000, winnerCount: 1 } },
  ...over,
});
const powerDraw = (over: Partial<DrawResult> = {}): DrawResult => ({
  gameId: 'power655',
  drawId: 'P1',
  drawDate: '2026-08-01',
  numbers: [1, 2, 3, 4, 5, 6],
  bonus: 7,
  pools: { jackpot1: { amountVnd: 60_000_000_000, winnerCount: 1 }, jackpot2: { amountVnd: 3_000_000_000, winnerCount: 1 } },
  ...over,
});
const mega = (...lines: number[][]): LotteryTicket => ({ gameId: 'mega645', drawId: 'M1', lines });
const power = (...lines: number[][]): LotteryTicket => ({ gameId: 'power655', drawId: 'P1', lines });
const tier = (r: ReturnType<typeof checkCombination>) => r?.id ?? 'none';

describe('checkCombination', () => {
  it('Mega tiers', () => {
    const d = megaDraw();
    const cases: [number[], string][] = [
      [[1, 2, 3, 4, 5, 6], 'jackpot'],
      [[1, 2, 3, 4, 5, 40], 'first'],
      [[1, 2, 3, 4, 40, 41], 'second'],
      [[1, 2, 3, 40, 41, 42], 'third'],
      [[1, 2, 40, 41, 42, 43], 'none'],
      [[1, 40, 41, 42, 43, 44], 'none'],
      [[40, 41, 42, 43, 44, 45], 'none'],
    ];
    for (const [c, t] of cases) expect(tier(checkCombination(MEGA_645, c, d))).toBe(t);
  });
  it('Power tiers', () => {
    const d = powerDraw();
    const cases: [number[], string][] = [
      [[1, 2, 3, 4, 5, 6], 'jackpot1'],
      [[1, 2, 3, 4, 5, 7], 'jackpot2'],
      [[1, 2, 3, 4, 5, 40], 'first'],
      [[1, 2, 3, 4, 40, 41], 'second'],
      [[1, 2, 3, 4, 7, 41], 'second'],
      [[1, 2, 3, 40, 41, 42], 'third'],
      [[1, 2, 40, 41, 42, 43], 'none'],
      [[1, 40, 41, 42, 43, 44], 'none'],
      [[40, 41, 42, 43, 44, 45], 'none'],
    ];
    for (const [c, t] of cases) expect(tier(checkCombination(POWER_655, c, d))).toBe(t);
  });
});

describe('checkTicket pools', () => {
  it('jackpot amount from the draw result', () => {
    const r = checkTicket(MEGA_645, mega([1, 2, 3, 4, 5, 6]), megaDraw());
    expect(r).toMatchObject({ ok: true, grossVnd: 30_000_000_000, status: 'won', topTier: 'jackpot' });
  });
  it('shares by published winnerCount (floor)', () => {
    const d = megaDraw({ pools: { jackpot: { amountVnd: 10_000_000_000, winnerCount: 3 } } });
    expect(checkTicket(MEGA_645, mega([1, 2, 3, 4, 5, 6]), d)).toMatchObject({ grossVnd: 3_333_333_333 });
  });
  it('own winning combos above winnerCount are the divisor', () => {
    const d = powerDraw({ pools: { jackpot1: { amountVnd: 60_000_000_000, winnerCount: 1 }, jackpot2: { amountVnd: 1_000, winnerCount: 0 } } });
    // bao 5 of the regulars: 1 jackpot1, 1 jackpot2 (bonus), 48 first
    const r = checkTicket(POWER_655, power([1, 2, 3, 4, 5]), d);
    expect(r).toMatchObject({ ok: true, tierCounts: { jackpot2: 1 } });
    const two = checkTicket(POWER_655, power([1, 2, 3, 4, 5, 6, 7]), powerDraw({ pools: { jackpot1: { amountVnd: 100, winnerCount: 0 }, jackpot2: { amountVnd: 100, winnerCount: 1 } } }));
    // 6 regulars + bonus in bao 7: jackpot1 x1; jackpot2 x6 (drop one regular, keep bonus)
    expect(two).toMatchObject({ ok: true, tierCounts: { jackpot1: 1, jackpot2: 6 } });
    if (two.ok) expect(two.wins.filter((w) => w.tierId === 'jackpot2').every((w) => w.grossVnd === 16)).toBe(true);
  });
  it('missing pool amount errors', () => {
    const r = checkTicket(MEGA_645, mega([1, 2, 3, 4, 5, 6]), megaDraw({ pools: {} }));
    expect(r).toMatchObject({ ok: false, error: { code: 'missing_pool_amount' } });
  });
});

describe('checkTicket bao', () => {
  it('Mega bao 7 with all 6 drawn: 1 jackpot + 6 first', () => {
    const r = checkTicket(MEGA_645, mega([1, 2, 3, 4, 5, 6, 40]), megaDraw());
    expect(r).toMatchObject({ ok: true, tierCounts: { jackpot: 1, first: 6 }, grossVnd: 30_000_000_000 + 60_000_000, costVnd: 70_000 });
  });
  it('Power bao 5 of drawn regulars: 1 jackpot1 + 1 jackpot2 + 48 first', () => {
    const r = checkTicket(POWER_655, power([1, 2, 3, 4, 5]), powerDraw());
    expect(r).toMatchObject({
      ok: true,
      tierCounts: { jackpot1: 1, jackpot2: 1, first: 48 },
      grossVnd: 60_000_000_000 + 3_000_000_000 + 48 * 40_000_000,
    });
  });
});

describe('checkTicket tax', () => {
  const t = mega([1, 2, 3, 4, 5, 40, 41]); // 2 x first + 5 x second = 21,500,000
  it('per-ticket basis sums then taxes once', () => {
    expect(checkTicket(MEGA_645, t, megaDraw())).toMatchObject({ grossVnd: 21_500_000, taxVnd: 150_000, netVnd: 21_350_000 });
    expect(checkTicket(MEGA_645, t, megaDraw({ drawDate: '2026-06-30' }))).toMatchObject({ grossVnd: 21_500_000, taxVnd: 1_150_000 });
  });
  it('perCombination basis via options', () => {
    expect(checkTicket(MEGA_645, t, megaDraw(), { taxBasis: 'perCombination' })).toMatchObject({ taxVnd: 0 });
    expect(checkTicket(MEGA_645, t, megaDraw({ drawDate: '2026-06-30' }), { taxBasis: 'perCombination' })).toMatchObject({ taxVnd: 0 });
  });
  it('multi-line ticket sums prizes across lines', () => {
    // each line: one first (10,000,000) + nothing else -> 2 lines = 20,000,000 +; add a second to cross
    const r = checkTicket(MEGA_645, mega([1, 2, 3, 4, 5, 40], [1, 2, 3, 4, 5, 41], [1, 2, 3, 4, 40, 41]), megaDraw({ drawDate: '2026-06-30' }));
    expect(r).toMatchObject({ grossVnd: 20_300_000, taxVnd: 1_030_000 });
  });
  it('lost ticket and integer outputs', () => {
    const r = checkTicket(MEGA_645, mega([40, 41, 42, 43, 44, 45]), megaDraw());
    expect(r).toMatchObject({ ok: true, status: 'lost', topTier: null, grossVnd: 0, taxVnd: 0, netVnd: 0, costVnd: 10_000 });
    const w = checkTicket(MEGA_645, t, megaDraw());
    if (w.ok) {
      for (const n of [w.costVnd, w.grossVnd, w.taxVnd, w.netVnd]) expect(Number.isSafeInteger(n)).toBe(true);
      expect(w.netVnd).toBe(w.grossVnd - w.taxVnd);
      expect(w.status).toBe('won');
      expect(w.topTier satisfies TierId | null).toBe('first');
    }
  });
});

describe('checkTicket rejects', () => {
  const ok = mega([1, 2, 3, 4, 5, 6]);
  it.each([
    ['game mismatch', () => checkTicket(MEGA_645, power([1, 2, 3, 4, 5, 6]), megaDraw()), 'game_mismatch'],
    ['draw mismatch', () => checkTicket(MEGA_645, ok, megaDraw({ drawId: 'M2' })), 'draw_mismatch'],
    ['wrong draw count', () => checkTicket(MEGA_645, ok, megaDraw({ numbers: [1, 2, 3, 4, 5] })), 'invalid_draw'],
    ['duplicate draw', () => checkTicket(MEGA_645, ok, megaDraw({ numbers: [1, 1, 3, 4, 5, 6] })), 'invalid_draw'],
    ['draw out of range', () => checkTicket(MEGA_645, ok, megaDraw({ numbers: [1, 2, 3, 4, 5, 46] })), 'invalid_draw'],
    ['power missing bonus', () => checkTicket(POWER_655, power([1, 2, 3, 4, 5, 6]), powerDraw({ bonus: undefined })), 'invalid_draw'],
    ['power duplicate bonus', () => checkTicket(POWER_655, power([1, 2, 3, 4, 5, 6]), powerDraw({ bonus: 3 })), 'invalid_draw'],
    ['mega with bonus', () => checkTicket(MEGA_645, ok, megaDraw({ bonus: 7 })), 'invalid_draw'],
    ['bad date', () => checkTicket(MEGA_645, ok, megaDraw({ drawDate: '2026-13-40' })), 'invalid_draw_date'],
    ['invalid line', () => checkTicket(MEGA_645, mega([1, 2, 3]), megaDraw()), 'size_not_allowed'],
  ] as const)('%s', (_n, run, code) => {
    const r = run();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(code);
  });
});
