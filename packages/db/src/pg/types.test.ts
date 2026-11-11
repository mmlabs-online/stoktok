import pg from 'pg';
import { describe, expect, test } from 'vitest';
import { buildTypeParsers, normalizeTimestamptz, parseArray } from './types';

describe('normalizeTimestamptz', () => {
  test("normalizes '2026-11-10 08:00:00+00' to '2026-11-10T08:00:00+00:00'", () => {
    expect(normalizeTimestamptz('2026-11-10 08:00:00+00')).toBe('2026-11-10T08:00:00+00:00');
  });
  test("keeps microseconds '…08:00:00.123456+00' → '…T08:00:00.123456+00:00'", () => {
    expect(normalizeTimestamptz('2026-11-10 08:00:00.123456+00')).toBe('2026-11-10T08:00:00.123456+00:00');
  });
  test("pads '+07', keeps '+05:30', handles '-03'", () => {
    expect(normalizeTimestamptz('2026-11-10 08:00:00+07')).toBe('2026-11-10T08:00:00+07:00');
    expect(normalizeTimestamptz('2026-11-10 08:00:00+05:30')).toBe('2026-11-10T08:00:00+05:30');
    expect(normalizeTimestamptz('2026-11-10 08:00:00-03')).toBe('2026-11-10T08:00:00-03:00');
  });
  test("'infinity' / '-infinity' / malformed are returned unchanged", () => {
    for (const s of ['infinity', '-infinity', 'garbage', '2026-11-10 08:00:00']) expect(normalizeTimestamptz(s)).toBe(s);
  });
});

describe('parseArray', () => {
  test('handles empty, plain, quoted and NULL elements', () => {
    const id = (s: string) => s;
    expect(parseArray('{}', id)).toEqual([]);
    expect(parseArray('{2026-01-01,2026-01-02}', id)).toEqual(['2026-01-01', '2026-01-02']);
    expect(parseArray('{"2026-11-10 08:00:00+00",NULL}', id)).toEqual(['2026-11-10 08:00:00+00', null]);
    expect(parseArray('{"a,b","c\\"d"}', id)).toEqual(['a,b', 'c"d']);
  });
});

describe('buildTypeParsers', () => {
  test('DATE and DATE[] parsers return raw strings; int8 parser is not overridden', () => {
    const t = buildTypeParsers();
    const get = (oid: number) => t.getTypeParser(oid as never, 'text');
    expect(get(1082)('2026-11-10')).toBe('2026-11-10');
    expect(get(1182)('{2026-11-10,2026-11-11}')).toEqual(['2026-11-10', '2026-11-11']);
    expect(get(1184)('2026-11-10 08:00:00+00')).toBe('2026-11-10T08:00:00+00:00');
    expect(get(1185)('{"2026-11-10 08:00:00+00"}')).toEqual(['2026-11-10T08:00:00+00:00']);
    expect(get(20)).toBe(pg.types.getTypeParser(20, 'text'));
    expect(get(20)('9007199254740993')).toBe('9007199254740993');
  });
});
