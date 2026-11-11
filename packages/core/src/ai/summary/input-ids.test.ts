import { describe, expect, test } from 'vitest';
import { formatInputId, parseInputId } from './input-ids';
import type { InputRef } from './input-ids';

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

describe('input ids', () => {
  test('formats and parses px / sig / news / fin / hold / sum / missing ids (round-trip)', () => {
    const cases: [InputRef, string][] = [
      [{ kind: 'px', symbol: 'VNM', date: '2026-11-10' }, 'px:VNM:2026-11-10'],
      [{ kind: 'sig', symbol: 'FPT', ruleId: 'trend_ma', date: '2026-11-10' }, 'sig:FPT:trend_ma:2026-11-10'],
      [{ kind: 'news', id: 123 }, 'news:123'],
      [{ kind: 'fin', symbol: 'VNM', period: '2026Q3' }, 'fin:VNM:2026Q3'],
      [{ kind: 'fin', symbol: 'VNM', period: '2025' }, 'fin:VNM:2025'],
      [{ kind: 'hold', symbol: 'VNM', date: '2026-11-10' }, 'hold:VNM:2026-11-10'],
      [{ kind: 'sum', symbol: 'VNM', date: '2026-11-10' }, 'sum:VNM:2026-11-10'],
      [{ kind: 'missing', subject: 'VNM', topic: 'news' }, 'missing:VNM:news'],
      [{ kind: 'missing', subject: 'PORTFOLIO', topic: 'portfolio' }, 'missing:PORTFOLIO:portfolio'],
    ];
    for (const [ref, id] of cases) {
      expect(formatInputId(ref)).toBe(id);
      expect(id).toMatch(ID_RE);
      expect(parseInputId(id)).toEqual(ref);
    }
  });

  test('rejects ids over 64 chars, lowercase symbols, bad dates/periods, unknown kinds, commas', () => {
    for (const id of [
      `news:${'1'.repeat(70)}`,
      'px:vnm:2026-11-10',
      'px:VNM:2026-13-40',
      'px:VNM:2026-02-30',
      'fin:VNM:2026Q5',
      'fin:VNM:26',
      'foo:VNM:2026-11-10',
      'news:0',
      'news:012',
      'news:1,2',
      'px:VNM:2026-11-10:x',
      'missing:VNM:bogus',
      'missing:vnm:news',
      'sig:VNM:Bad-Rule:2026-11-10',
      '',
    ]) {
      expect(parseInputId(id), id).toBeNull();
    }
    expect(formatInputId({ kind: 'px', symbol: 'VNM', date: '2026-02-30' })).toBeNull();
    expect(formatInputId({ kind: 'news', id: 1.5 })).toBeNull();
  });

  test('formatInputId returns null when the id would exceed 64 chars (long rule_id)', () => {
    expect(formatInputId({ kind: 'sig', symbol: 'VNM', ruleId: 'a'.repeat(60), date: '2026-11-10' })).toBeNull();
    expect(formatInputId({ kind: 'sig', symbol: 'VNM', ruleId: 'a'.repeat(30), date: '2026-11-10' })).not.toBeNull();
  });
});
