import { describe, expect, test } from 'vitest';
import { sanitizeSummaryOutput } from './sanitize';
import type { SanitizeContext } from './sanitize';
import { utf8ByteLength } from '../cost';
import { AI_SUMMARY_CONFIG } from './config';
import { parseStoredSummaryBody } from './body';

const ctx: SanitizeContext = {
  subject: 'VNM',
  topics: ['price', 'signals', 'news', 'financials'],
  providedIds: ['px:VNM:2026-11-10', 'sig:VNM:trend_ma:2026-11-10', 'news:1', 'news:2', 'fin:VNM:2026Q3'],
  missingTopics: [],
};
const s = (text: string, inputIds: unknown = ['px:VNM:2026-11-10']) => ({ text, inputIds });
const out = (topic: string, ...sentences: unknown[]) => ({ topic, sentences });
const run = (sections: unknown[], c: Partial<SanitizeContext> = {}) => {
  const r = sanitizeSummaryOutput({ sections }, { ...ctx, ...c });
  if (!r.ok) throw new Error('not ok');
  return r;
};
const texts = (r: ReturnType<typeof run>, topic: string) => r.body.sections.find((x) => x.topic === topic)?.sentences.map((x) => x.text);

describe('sanitizeSummaryOutput', () => {
  test("malformed output returns {ok:false, code:'malformed'}", () => {
    for (const raw of [null, 'x', [], { sections: 'x' }, { sections: [5] }, { sections: [{ topic: 'price', sentences: 'x' }] }, { sections: [{ topic: 'price', sentences: ['x'] }] }]) {
      expect(sanitizeSummaryOutput(raw, ctx)).toEqual({ ok: false, code: 'malformed' });
    }
  });

  test('bad subject returns bad_context', () => {
    expect(sanitizeSummaryOutput({ sections: [] }, { ...ctx, subject: 'vnm' })).toEqual({ ok: false, code: 'bad_context' });
  });

  test('keeps sentences whose ids are all provided', () => {
    const r = run([out('price', s('Giá đóng cửa tăng nhẹ.', ['px:VNM:2026-11-10', 'sig:VNM:trend_ma:2026-11-10']))]);
    expect(texts(r, 'price')).toEqual(['Giá đóng cửa tăng nhẹ.']);
    expect(r.stripped).toMatchObject({ no_ids: 0, unknown_id: 0 });
    expect(parseStoredSummaryBody(r.body, undefined, { inputIds: r.inputIds, subject: 'VNM' })).toEqual(r.body);
  });

  test('drops sentences with no inputIds', () => {
    const r = run([out('price', s('A.', []), s('B.', null), s('C.'))]);
    expect(texts(r, 'price')).toEqual(['C.']);
    expect(r.stripped.no_ids).toBe(2);
    expect(r.body.strippedCount).toBe(2);
  });

  test('drops sentences citing an id that was not provided (even when another id is valid)', () => {
    const r = run([out('price', s('A.', ['px:VNM:2026-11-10', 'news:99']), s('B.', ['news:99']), s('C.', [7]))]);
    expect(texts(r, 'price')).toEqual(['Không có dữ liệu.']);
    expect(r.body.sections[0]?.missing).toBe(true);
    expect(r.stripped.unknown_id).toBe(3);
  });

  test('drops sentences that cite a missing: marker', () => {
    const r = run([out('news', s('A.', ['news:1', 'missing:VNM:news']))]);
    expect(r.stripped.missing_marker).toBe(1);
    expect(r.body.sections.find((x) => x.topic === 'news')?.missing).toBe(true);
  });

  test('missing topic is replaced by the no-data sentence citing its marker', () => {
    const r = run([out('news', s('Có tin.', ['news:1']))], { missingTopics: ['news'] });
    expect(r.body.sections.find((x) => x.topic === 'news')).toEqual({
      topic: 'news',
      missing: true,
      sentences: [{ text: 'Không có dữ liệu.', inputIds: ['missing:VNM:news'] }],
    });
  });

  test('model sentences for a missing topic are dropped and counted', () => {
    const r = run([out('news', s('A.', ['news:1']), s('B.', ['news:2']))], { missingTopics: ['news'] });
    expect(r.stripped.missing_topic_claim).toBe(2);
    expect(r.citedIds).toEqual([]);
  });

  test('topic with no surviving sentence becomes no-data', () => {
    const r = run([out('price', s('A.'))]);
    expect(r.body.sections.map((x) => [x.topic, x.missing])).toEqual([
      ['price', false],
      ['signals', true],
      ['news', true],
      ['financials', true],
    ]);
  });

  test('everything stripped gives an all-no-data body (ok:true)', () => {
    const r = run([out('price', s('A.', [])), out('news', s('B.', ['news:9']))]);
    expect(r.body.sections.every((x) => x.missing)).toBe(true);
    expect(r.citedIds).toEqual([]);
    expect(r.body.strippedCount).toBe(2);
  });

  test('drops deny-listed sentences (giá mục tiêu, mục tiêu giá, target price, kỳ vọng tăng, cam kết lợi nhuận, đảm bảo sinh lời, chắc chắn tăng, nên mua, nên bán, khuyến nghị mua)', () => {
    const bad = [
      'Giá mục tiêu là 80.000.',
      'Mục tiêu giá 80.000.',
      'The Target Price is 80.',
      'Kỳ vọng tăng mạnh.',
      'Cam kết lợi nhuận cao.',
      'Đảm bảo sinh lời.',
      'Chắc chắn tăng.',
      'Nên mua ngay.',
      'Nên bán cổ phiếu.',
      'Khuyến nghị mua.',
      'Giá sẽ tăng lên 90.000.',
    ];
    const r = run([out('price', ...bad.map((t) => s(t)))]);
    expect(r.stripped.deny_listed).toBe(bad.length);
    expect(r.body.sections[0]?.missing).toBe(true);
  });

  test('does not drop plain statement terms (lợi nhuận sau thuế, doanh thu, biên lợi nhuận)', () => {
    const ok = ['Lợi nhuận sau thuế quý 3 đạt 2.000 tỷ.', 'Doanh thu tăng 5%.', 'Biên lợi nhuận gộp giảm.'];
    const r = run([out('financials', ...ok.map((t) => s(t, ['fin:VNM:2026Q3'])))]);
    expect(texts(r, 'financials')).toEqual(ok);
  });

  test('drops sentences with markup, URLs or control/bidi chars (<img onerror>, [x](y), https://, www., ‮)', () => {
    const bad = ['<img src=x onerror=alert(1)>', '[x](y)', 'Xem https://evil.example', 'Xem www.evil.example', 'abc‮def', 'a\u0000b', 'a​b', '**bold**'];
    const r = run([out('price', ...bad.map((t) => s(t)))]);
    expect(r.stripped.invalid_text).toBe(bad.length);
  });

  test('bad providedIds (invalid format or a missing: marker) return bad_context', () => {
    for (const id of ['bad id', 'missing:VNM:news', 'px:vnm:2026-11-10']) {
      expect(sanitizeSummaryOutput({ sections: [] }, { ...ctx, providedIds: [id] })).toEqual({ ok: false, code: 'bad_context' });
    }
  });

  test('drops invisible and lookalike characters (U+00AD, U+E0041 tag, Cyrillic а, U+034F, variation selector)', () => {
    const bad = ['nê\u00adn mua', 'Giá\u{E0041} tăng', 'Giá nên mu\u0430', 'Giá\u034F tăng', 'Giá\uFE0F tăng', 'Giá \u0442ăng'];
    const r = run([out('price', ...bad.map((t) => s(t)))]);
    expect(r.stripped.invalid_text).toBe(bad.length);
  });

  test('keeps real Vietnamese text with diacritics, dong sign and percent', () => {
    const ok = ['Giá đóng cửa ở mức 70.000 ₫ (tăng 1,5%).', 'Thanh khoản cải thiện, khối ngoại bán ròng.', 'Đường trung bình động 20 phiên nằm dưới giá.'];
    const r = run([out('price', ...ok.map((t) => s(t)))]);
    expect(texts(r, 'price')).toEqual(ok);
    expect(r.stripped.invalid_text).toBe(0);
  });

  test('NFKC-normalises text (decomposed Vietnamese is stored composed)', () => {
    const r = run([out('price', s('Giá đóng cửa.'))]);
    expect(texts(r, 'price')).toEqual(['Giá đóng cửa.']);
  });

  test('deny-list also catches bypasses: no diacritics, reversed order, other advice verbs, forecasts with a number', () => {
    const bad = [
      'nen mua',
      'gia muc tieu 80.000',
      'Price target 80.',
      'Lợi nhuận kỳ vọng cao.',
      'Nên gom thêm.',
      'Nên chốt lời.',
      'Nên cắt lỗ.',
      'Nên nắm giữ.',
      'Nên tích lũy.',
      'Khuyên mua.',
      'Khuyến nghị nắm giữ.',
      'Tiềm năng tăng lớn.',
      'Dự báo giá cuối năm.',
      'Upside 20%.',
      'You should buy.',
      'You should sell.',
      'Giá sẽ tăng 20%.',
      'Giá có thể giảm khoảng 10%.',
      'Giá sẽ tăng   mạnh 5 điểm.',
    ];
    const r = run([out('price', ...bad.map((t) => s(t)))]);
    expect(r.stripped.deny_listed).toBe(bad.length);
  });

  test('deny-list keeps neutral past/present statements', () => {
    const ok = ['Doanh thu tăng 5%.', 'Giá đã giảm 2% trong phiên.', 'Công ty công bố kế hoạch mở rộng.'];
    const r = run([out('financials', ...ok.map((t) => s(t, ['fin:VNM:2026Q3'])))]);
    expect(texts(r, 'financials')).toEqual(ok);
  });

  test('trims/collapses whitespace, NFC-normalises; drops empty and over-long sentences', () => {
    const r = run([out('price', s('  Giá   đóng\n cửa  ', ['px:VNM:2026-11-10']), s('é.'), s('   '), s('x'.repeat(281)))]);
    expect(texts(r, 'price')).toEqual(['Giá đóng cửa', 'é.']);
    expect(r.stripped.invalid_text).toBe(2);
  });

  test('caps sentences per section and ids per sentence (over_limit)', () => {
    const many = Array.from({ length: 6 }, (_, i) => s(`S${i}.`));
    const r = run([out('price', ...many)]);
    expect(texts(r, 'price')).toHaveLength(AI_SUMMARY_CONFIG.maxSentencesPerSection);
    expect(r.stripped.over_limit).toBe(2);
    const ids = ['px:VNM:2026-11-10', 'sig:VNM:trend_ma:2026-11-10', 'news:1', 'news:2', 'fin:VNM:2026Q3', 'news:3', 'news:4'];
    const r2 = run([out('price', s('A.', ids))], { providedIds: ids });
    expect(r2.stripped.over_limit).toBe(1);
  });

  test('unknown topic and topic not in ctx.topics are dropped; duplicate topic keeps the first', () => {
    const r = run(
      [out('bogus', s('A.')), out('portfolio', s('B.')), out('price', s('First.')), out('price', s('Second.'))],
    );
    expect(texts(r, 'price')).toEqual(['First.']);
    expect(r.body.sections.some((x) => x.topic === 'portfolio')).toBe(false);
    expect(r.stripped.bad_topic).toBe(3);
  });

  test('sections come out in canonical topic order', () => {
    const r = run([out('financials', s('F.', ['fin:VNM:2026Q3'])), out('price', s('P.'))], { topics: ['financials', 'news', 'price'] });
    expect(r.body.sections.map((x) => x.topic)).toEqual(['price', 'news', 'financials']);
  });

  test('citedIds is the sorted unique union of surviving ids; inputIds = provided ∪ marker ids', () => {
    const r = run([out('price', s('A.', ['px:VNM:2026-11-10']), s('B.', ['news:2', 'px:VNM:2026-11-10']))]);
    expect(r.citedIds).toEqual(['news:2', 'px:VNM:2026-11-10']);
    expect(r.inputIds).toEqual([
      'fin:VNM:2026Q3',
      'missing:VNM:financials',
      'missing:VNM:news',
      'missing:VNM:signals',
      'news:1',
      'news:2',
      'px:VNM:2026-11-10',
      'sig:VNM:trend_ma:2026-11-10',
    ]);
  });

  test('body stays within maxBodyBytes (trailing sentences trimmed)', () => {
    const cfg = { ...AI_SUMMARY_CONFIG, maxBodyBytes: 600 };
    const sents = Array.from({ length: 4 }, (_, i) => s(`Câu số ${i} ${'x'.repeat(100)}`));
    const r = sanitizeSummaryOutput({ sections: [out('price', ...sents)] }, ctx, cfg);
    if (!r.ok) throw new Error('not ok');
    expect(utf8ByteLength(JSON.stringify(r.body))).toBeLessThanOrEqual(600);
    expect(r.stripped.over_limit).toBeGreaterThan(0);
  });

  test('stripped counts per reason', () => {
    const r = run([out('price', s('A.', []), s('Nên mua.'), s('B.', ['news:9']), s('<x>'), s('OK.'))]);
    expect(r.stripped).toEqual({
      invalid_text: 1,
      deny_listed: 1,
      no_ids: 1,
      unknown_id: 1,
      missing_marker: 0,
      missing_topic_claim: 0,
      over_limit: 0,
      bad_topic: 0,
    });
    expect(r.body.strippedCount).toBe(4);
  });
});
