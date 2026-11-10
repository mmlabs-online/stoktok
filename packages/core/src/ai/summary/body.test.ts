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
const ids = ['px:VNM:2026-11-10', 'missing:VNM:news'];
const rowCtx = { inputIds: ids, subject: 'VNM' };
const parse = (raw: unknown) => parseStoredSummaryBody(raw, undefined, rowCtx);
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
    expect(parseStoredSummaryBody(body, undefined, { inputIds: body.sections.map((x) => `missing:VNM:${x.topic}`), subject: 'VNM' })).toEqual(body);
  });
  test('throws on an invalid subject', () => {
    expect(() => noDataBody('vnm', ['price'])).toThrow(RangeError);
  });
});

describe('parseStoredSummaryBody', () => {
  test('accepts a valid v1 body', () => {
    expect(parse(valid)).toEqual(valid);
  });

  test('drops unknown keys', () => {
    const b = clone();
    b.extra = { a: 1 };
    b.sections[0].extra = 1;
    expect(parse(b)).toEqual(valid);
  });

  test('rejects wrong version, empty sections, sentence without ids, bad id format, over-long text, oversize JSON, extra-deep junk', () => {
    const mutate = (f: (b: Mut) => void) => {
      const b = clone();
      f(b);
      return parse(b);
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
    for (const v of [null, 'x', [], 5, {}]) expect(parse(v)).toBeNull();
  });

  test('rejects deny-listed text (also without diacritics) and invisible/lookalike characters', () => {
    const mutate = (text: string) => {
      const b = clone();
      b.sections[0].sentences[0].text = text;
      return parse(b);
    };
    for (const t of ['Nên – mua', 'nên/mua', 'nên: mua', 'Nên mua ngay.', 'nen mua', 'Price target 80.', 'Giá sẽ tăng 20%.', 'nê­n', 'a\u{E0041}b', 'nên muа']) expect(mutate(t)).toBeNull();
    expect(mutate('Giá đóng cửa 70.000 ₫, tăng 1,5%.')).not.toBeNull();
  });

  test('rejects Latin lookalikes, combining marks and non-ASCII digits', () => {
    const mutate = (text: string) => {
      const b = clone();
      b.sections[0].sentences[0].text = text;
      return parse(b);
    };
    for (const t of ['Nên muɑ', 'ɡiá', 'Giá\u0336 tăng', 'Giá 70.\u0662', 'Giá tăng 5\u0662%']) expect(mutate(t)).toBeNull();
  });

  test('accepts real Vietnamese covering every tone mark, upper and lower case', () => {
    const sentences = [
      'Thị trường điều chỉnh nhẹ, thanh khoản cải thiện so với phiên trước.',
      'Khối ngoại bán ròng; nhóm ngân hàng giữ vững mức giá.',
      'ĐƯỢC ƠI, QUÝ KHÁCH HÀNG ĐÃ NHẬN ĐƯỢC LỢI NHUẬN. ỔN ĐỊNH, ĂN Ở, ÔNG ẤY.',
      'À ẢO Ã Á Ạ, È Ẻ Ẽ É Ẹ, Ì Ỉ Ĩ Í Ị, Ò Ỏ Õ Ó Ọ, Ù Ủ Ũ Ú Ụ, Ỳ Ỷ Ỹ Ý Ỵ.',
      'à ả ã á ạ, è ẻ ẽ é ẹ, ì ỉ ĩ í ị, ò ỏ õ ó ọ, ù ủ ũ ú ụ, ỳ ỷ ỹ ý ỵ.',
      'Ằ Ẳ Ẵ Ắ Ặ, Ầ Ẩ Ẫ Ấ Ậ, Ề Ể Ễ Ế Ệ, Ồ Ổ Ỗ Ố Ộ, Ờ Ở Ỡ Ớ Ợ, Ừ Ử Ữ Ứ Ự.',
      'ằ ẳ ẵ ắ ặ, ầ ẩ ẫ ấ ậ, ề ể ễ ế ệ, ồ ổ ỗ ố ộ, ờ ở ỡ ớ ợ, ừ ử ữ ứ ự.',
      'Đường trung bình động 20 phiên nằm dưới giá 70.000 ₫ (tăng 1,5%).',
    ];
    for (const text of sentences) {
      const b = clone();
      b.sections[0].sentences[0].text = text;
      expect(parse(b), text).toEqual(b);
    }
  });

  test('missing:true needs exactly the no-data sentence citing its own topic marker', () => {
    const mutate = (f: (sec: Mut) => void) => {
      const b = clone();
      f(b.sections[1]);
      return parse(b);
    };
    expect(mutate((s) => (s.sentences[0].text = 'Tin tốt.'))).toBeNull();
    expect(mutate((s) => (s.sentences[0].inputIds = ['px:VNM:2026-11-10']))).toBeNull();
    expect(mutate((s) => (s.sentences[0].inputIds = ['missing:VNM:price']))).toBeNull();
    expect(mutate((s) => (s.sentences[0].inputIds = ['missing:VNM:news', 'px:VNM:2026-11-10']))).toBeNull();
    expect(mutate((s) => s.sentences.push({ text: 'Không có dữ liệu.', inputIds: ['missing:VNM:news'] }))).toBeNull();
  });

  test('missing:false must not cite a missing: marker', () => {
    const b = clone();
    b.sections[0].sentences[0].inputIds = ['px:VNM:2026-11-10', 'missing:VNM:price'];
    expect(parse(b)).toBeNull();
  });

  test('topics must match the row scope', () => {
    const sym = clone();
    sym.sections[0].topic = 'portfolio';
    expect(parse(sym)).toBeNull();
    const pf = { version: 1, strippedCount: 0, sections: [{ topic: 'portfolio', missing: false, sentences: [{ text: 'Danh mục ổn định.', inputIds: ['px:VNM:2026-11-10'] }] }] };
    const pfCtx = { inputIds: ['px:VNM:2026-11-10'], subject: 'PORTFOLIO' };
    expect(parseStoredSummaryBody(pf, undefined, pfCtx)).toEqual(pf);
    expect(parseStoredSummaryBody({ ...pf, sections: [{ ...pf.sections[0], topic: 'price' }] }, undefined, pfCtx)).toBeNull();
    const pfMissing = noDataBody('PORTFOLIO', ['price']);
    expect(parseStoredSummaryBody(pfMissing, undefined, { inputIds: ['missing:PORTFOLIO:price'], subject: 'PORTFOLIO' })).toBeNull();
  });

  test('with row context: cited ids must be in input_ids, and match the subject', () => {
    expect(parseStoredSummaryBody(valid, undefined, { inputIds: ids, subject: 'VNM' })).toEqual(valid);
    expect(parseStoredSummaryBody(valid, undefined, { inputIds: ['px:VNM:2026-11-10'], subject: 'VNM' })).toBeNull();
    expect(parseStoredSummaryBody(valid, undefined, { inputIds: ids, subject: 'FPT' })).toBeNull();
    const b = clone();
    b.sections[0].sentences[0].inputIds = ['px:FPT:2026-11-10'];
    expect(parseStoredSummaryBody(b, undefined, { inputIds: [...ids, 'px:FPT:2026-11-10'], subject: 'VNM' })).toBeNull();
    expect(parseStoredSummaryBody(b, undefined, { inputIds: [...ids, 'px:FPT:2026-11-10'], subject: 'PORTFOLIO' })).toBeNull(); // marker names VNM
  });
});
