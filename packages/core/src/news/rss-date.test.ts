import { describe, expect, test } from 'vitest';
import { parseRssDate } from './rss-date';

describe('parseRssDate', () => {
  test('"Sun, 08 Nov 26 20:54:00 +0700" -> 2026-11-08T13:54:00.000Z', () => {
    expect(parseRssDate('Sun, 08 Nov 26 20:54:00 +0700')).toBe('2026-11-08T13:54:00.000Z');
  });
  test('4-digit year with +0700 and GMT/Z', () => {
    expect(parseRssDate('Sun, 08 Nov 2026 20:54:00 +0700')).toBe('2026-11-08T13:54:00.000Z');
    expect(parseRssDate('Sun, 08 Nov 2026 13:54:00 GMT')).toBe('2026-11-08T13:54:00.000Z');
    expect(parseRssDate('8 Nov 2026 13:54 Z')).toBe('2026-11-08T13:54:00.000Z');
    expect(parseRssDate('Sun, 08 Nov 2026 20:54:00 -05:30')).toBe('2026-11-09T02:24:00.000Z');
  });
  test('rejects unparseable, missing, or out-of-range parts (no fallback to now)', () => {
    for (const bad of ['', 'yesterday', '2026-11-08T13:54:00Z', 'Sun, 31 Feb 2026 10:00:00 GMT', 'Sun, 08 Foo 2026 10:00:00 GMT', 'Sun, 08 Nov 2026 25:00:00 GMT', 'Sun, 08 Nov 2026 10:60:00 GMT', 'Sun, 08 Nov 2026 10:00:00', 'Sun, 08 Nov 2026 10:00:00 EST', 'Sun, 08 Nov 1999 10:00:00 GMT', 'Sun, 08 Nov 2026 10:00:00 +2500']) {
      expect(parseRssDate(bad), bad).toBeNull();
    }
  });
  test('weekday mismatch is ignored, not trusted', () => {
    expect(parseRssDate('Mon, 08 Nov 2026 13:54:00 GMT')).toBe('2026-11-08T13:54:00.000Z');
  });
});
