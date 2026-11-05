import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { vnDateOf } from '@stoktok/core';
import { describe, expect, test } from 'vitest';
import { VciIntradaySource } from './vci-intraday';

// Opt-in: runs only after Ming records live samples with work/tickets/STK-049/record-vci-intraday-samples.sh (ADR 0006).
const DIR = join(__dirname, '..', '..', '..', 'work', 'tickets', 'STK-049', 'live-samples');
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /^gapchart-.*\.json$/.test(f)) : [];

describe.skipIf(files.length === 0)('recorded gap-chart samples parse', () => {
  const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as unknown;
  const request = files.length ? (read('request.json') as { symbols: string[] }) : { symbols: [] };
  // README.md line "recorded_at_utc: <ISO>" is the recording time.
  const recordedAt = files.length ? new Date(/recorded_at_utc:\s*(\S+)/.exec(readFileSync(join(DIR, 'README.md'), 'utf8'))?.[1] ?? '') : new Date(0);

  test.each(files)('%s', async (f) => {
    const body = read(f);
    const source = new VciIntradaySource({
      fetchImpl: (async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body), headers: new Headers() })) as unknown as typeof fetch,
      http: { timeoutMs: 1000, maxAttempts: 1, backoffBaseMs: 0, sleep: async () => undefined, log: () => undefined },
    });
    const r = await source.fetchLatest(request.symbols, { now: recordedAt });
    expect(r.rejected).toEqual([]);
    expect(r.quotes.map((q) => q.symbol).sort()).toEqual([...request.symbols].sort());
    for (const q of r.quotes) {
      expect(vnDateOf(new Date(q.ts))).toBe(vnDateOf(recordedAt));
      expect(recordedAt.getTime() - Date.parse(q.ts)).toBeLessThanOrEqual(15 * 60_000);
      expect(q.volume).toBeGreaterThanOrEqual(0);
    }
    const vnm = r.quotes.find((q) => q.symbol === 'VNM');
    if (vnm) {
      expect(vnm.price).toBeGreaterThanOrEqual(10_000);
      expect(vnm.price).toBeLessThanOrEqual(999_999);
    }
  });
});
