import { describe, expect, test } from 'vitest';
import { mapLimit } from './fanout';

const tick = () => new Promise<void>((r) => setTimeout(r, 1));

describe('mapLimit', () => {
  test('preserves input order', async () => {
    const out = await mapLimit([3, 1, 2], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n * 3));
      return n * 10;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  test('never runs more than limit at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
      return n;
    });
    expect(out).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(2);
  });

  test('empty input resolves [] without calling fn', async () => {
    let calls = 0;
    expect(await mapLimit([], 2, async () => ++calls)).toEqual([]);
    expect(calls).toBe(0);
  });

  test('first rejection rejects, and no item starts after it', async () => {
    const started: number[] = [];
    await expect(
      mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
        started.push(n);
        await tick();
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
    await tick();
    await tick();
    expect(started).toEqual([1, 2, 3]);
  });
});
