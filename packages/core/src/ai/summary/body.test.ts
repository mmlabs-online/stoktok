import { describe, expect, test } from 'vitest';
import { SYMBOL_SUMMARY_TOPICS, noDataBody, parseStoredSummaryBody } from './body';

const valid = {
  version: 1,
  strippedCount: 2,
  sections: [
    { topic: 'price', missing: false, sentences: [{ text: 'Giá đóng cửa 70.000 đồng.', inputIds: ['px:VNM:2026-11-10'] }] },
    { topic: 'news', missing: true, sentences: [{ text: 'Không có dữ liệu.', inputIds: ['missing:VNM:news'] }] },
  ],
};
type Mut = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const clone = () => JSON.parse(JSON.stringify(valid)) as Mut;

describe('noDataBody', () => {
  test('noDataBody covers every topic in order, each citing missing:<SUBJ>:<topic>', () => {
    const body = noDataBody('VNM', SYMBOL_SUMMARY_TOPICS);
    expect(body.sections.map((s) => s.topic)).toEqual(['price', 'signals', 'news', 'financials']);
    for (const s of body.sections) {
      expect(s.missing).toBe(true);
      expect(s.sentences).toEqual([{ text: 'Không có dữ liệu.', inputIds: [`missing:VNM:${s.topic}`] }]);
    }
    expect(body.strippedCount).toBe(0);
    expect(parseStoredSummaryBody(body)).toEqual(body);
  });
  test('throws on an invalid subject', () => {
    expect(() => noDataBody('vnm', ['price'])).toThrow(RangeError);
  });
});

describe('parseStoredSummaryBody', () => {
  test('accepts a valid v1 body', () => {
    expect(parseStoredSummaryBody(valid)).toEqual(valid);
  });

  test('drops unknown keys', () => {
    const b = clone();
    b.extra = { a: 1 };
    b.sections[0].extra = 1;
    expect(parseStoredSummaryBody(b)).toEqual(valid);
  });

  test('rejects wrong version, empty sections, sentence without ids, bad id format, over-long text, oversize JSON, extra-deep junk', () => {
    const mutate = (f: (b: Mut) => void) => {
      const b = clone();
      f(b);
      return parseStoredSummaryBody(b);
    };
    expect(mutate((b) => (b.version = 2))).toBeNull();
    expect(mutate((b) => (b.sections = []))).toBeNull();
    expect(mutate((b) => (b.sections[0].sentences = []))).toBeNull();
    expect(mutate((b) => (b.sections[0].sentences[0].inputIds = []))).toBeNull();
    expect(mutate((b) => (b.sections[0].sentences[0].inputIds = ['bad id']))).toBeNull();
    expect(mutate((b) => (b.sections[0].sentences[0].inputIds = [5]))).toBeNull();
    expect(mutate((b) => (b.sections[0].sentences[0].text = 'x'.repeat(281)))).toBeNull();
    expect(mutate((b) => (b.sections[0].sentences[0].text = '<b>x</b>'))).toBeNull();
    expect(mutate((b) => (b.sections[1].topic = 'price'))).toBeNull();
    expect(mutate((b) => (b.sections[0].topic = 'bogus'))).toBeNull();
    expect(mutate((b) => (b.strippedCount = -1))).toBeNull();
    expect(mutate((b) => (b.junk = 'x'.repeat(40_000)))).toBeNull();
    expect(
      mutate((b) => {
        let o: Mut = {};
        b.junk = o;
        for (let i = 0; i < 100_000; i++) o = o.n = {};
      }),
    ).toBeNull();
    for (const v of [null, 'x', [], 5, {}]) expect(parseStoredSummaryBody(v)).toBeNull();
  });
});
