import { describe, expect, test } from 'vitest';
import { canonicalTicketLines } from './canonical';

describe('canonicalTicketLines', () => {
  test('sorts numbers inside each line', () => {
    expect(canonicalTicketLines([[6, 1, 5, 2, 4, 3]])).toEqual([[1, 2, 3, 4, 5, 6]]);
  });
  test('sorts lines: shorter first, then numerically (not as strings: [2,…] before [10,…])', () => {
    expect(
      canonicalTicketLines([
        [10, 11, 12, 13, 14, 15],
        [2, 3, 4, 5, 6, 7],
      ]),
    ).toEqual([
      [2, 3, 4, 5, 6, 7],
      [10, 11, 12, 13, 14, 15],
    ]);
  });
  test('same ticket in a different order gives deep-equal output', () => {
    const a = canonicalTicketLines([[9, 8, 7, 6, 5, 4], [1, 2, 3, 4, 5, 6]]);
    const b = canonicalTicketLines([[6, 5, 4, 3, 2, 1], [4, 5, 6, 7, 8, 9]]);
    expect(a).toEqual(b);
  });
  test('does not mutate the input', () => {
    const input = [[3, 2, 1, 6, 5, 4], [1, 2, 3, 4, 5, 6]];
    canonicalTicketLines(input);
    expect(input).toEqual([[3, 2, 1, 6, 5, 4], [1, 2, 3, 4, 5, 6]]);
  });
  test('mixed regular (6) and bao (8) lines are kept', () => {
    const out = canonicalTicketLines([[1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6]]);
    expect(out.map((l) => l.length)).toEqual([6, 8]);
  });
});
