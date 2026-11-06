/**
 * Canonical form of ticket lines: numbers ascending inside each line, shorter lines first, then numeric
 * lexicographic. The same ticket in any order gives deep-equal output. Does not validate or mutate.
 */
export function canonicalTicketLines(lines: number[][]): number[][] {
  return lines
    .map((line) => [...line].sort((a, b) => a - b))
    .sort((a, b) => {
      if (a.length !== b.length) return a.length - b.length;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return (a[i] as number) - (b[i] as number);
      }
      return 0;
    });
}
