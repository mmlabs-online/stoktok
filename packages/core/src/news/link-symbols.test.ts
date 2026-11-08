import { describe, expect, test } from 'vitest';
import { NEWS_LINK_CONFIG } from './config';
import { linkSymbols } from './link-symbols';

const config = NEWS_LINK_CONFIG;
const set = (...s: string[]) => new Set(s);
const link = (text: string | string[], candidates: Set<string>, aliases: Record<string, string[]> = {}) => linkSymbols(text, { candidates, aliases, config });

describe('linkSymbols tickers', () => {
  const c = set('HPG', 'VIC', 'FPT');
  test('ticker at start / middle / end, next to punctuation and in parentheses', () => {
    expect(link('HPG tăng giá', c)).toEqual(['HPG']);
    expect(link('Cổ phiếu tăng, HPG dẫn đầu', c)).toEqual(['HPG']);
    expect(link('Thị trường đi lên nhờ FPT', c)).toEqual(['FPT']);
    expect(link('Giá FPT, HPG; (VIC) và "HPG".', c)).toEqual(['FPT', 'HPG', 'VIC']);
  });
  test('Unicode boundary: "HPGđ" or "ĐHPG" does not match; "HPG," matches', () => {
    expect(link('Tăng HPGđ mạnh', c)).toEqual([]);
    expect(link('Tăng ĐHPG mạnh', c)).toEqual([]);
    expect(link('Tăng HPG, mạnh', c)).toEqual(['HPG']);
  });
  test('case-sensitive: "vic" and "Vic" never match', () => {
    expect(link('vic Vic hpg Hpg', set('VIC', 'HPG'))).toEqual([]);
  });
  test('ticker inside a longer token, URL or hyphenated name (VN-Index) does not match', () => {
    expect(link('HPGX HPG2 xHPG https://cafef.vn/HPG/a HPG-Dung Quat www.HPG.vn', c)).toEqual([]);
    expect(link('VN-Index giảm', set('VIC'))).toEqual([]);
  });
  test('stop tokens (USD, GDP, CPI, IPO, ETF, VNINDEX, VN30, HNX30) never link', () => {
    const all = set('USD', 'GDP', 'CPI', 'IPO', 'ETF', 'VNINDEX', 'VN30', 'HNX30');
    expect(link('Giá USD, GDP, CPI, IPO, ETF, VNINDEX, VN30, HNX30 (USD) mã GDP', all)).toEqual([]);
  });
  test('ambiguous ticker (VND, GAS, CEO) links only with a context prefix, parentheses, or its alias', () => {
    const c2 = set('VND', 'GAS', 'CEO');
    expect(link('Tỷ giá VND tăng, GAS giảm, CEO nói', c2)).toEqual([]);
    expect(link('Chứng khoán (VND) báo lãi', c2)).toEqual(['VND']);
    expect(link('mã VND tăng', c2)).toEqual(['VND']);
    expect(link('Khuyến nghị cổ phiếu GAS hôm nay', c2)).toEqual(['GAS']);
    expect(link('HOSE: CEO tăng', c2)).toEqual(['CEO']);
    expect(link('xmã VND', c2)).toEqual([]);
    expect(link('VNDirect báo lãi', c2, { VND: ['VNDirect'] })).toEqual(['VND']);
  });
  test('city/index abbreviations (TP HCM, Tp. HCM, chỉ số VIX) do not link without context; "mã HCM" does', () => {
    const c3 = set('HCM', 'VIX');
    expect(link('Giá nhà tại TP HCM tăng mạnh', c3)).toEqual([]);
    expect(link('Tp. HCM và Hà Nội', c3)).toEqual([]);
    expect(link('Chỉ số VIX tăng', c3)).toEqual([]);
    expect(link('mã HCM tăng', c3)).toEqual(['HCM']);
  });
  test('only candidate symbols link; a non-candidate ticker shape is ignored', () => {
    expect(link('HPG và VIC và ABC', set('HPG'))).toEqual(['HPG']);
  });
  test('all-caps title: bare tickers ignored, context-prefixed and alias matches kept', () => {
    expect(link('HPG TĂNG GIÁ MẠNH', c)).toEqual([]);
    expect(link('CỔ PHIẾU HPG TĂNG GIÁ, (VIC) GIẢM', c)).toEqual(['HPG', 'VIC']);
    expect(link('VINGROUP BÁO LÃI', c, { VIC: ['Vingroup'] })).toEqual(['VIC']);
  });
  test('titles and excerpts are judged separately for all-caps', () => {
    expect(link(['HPG TĂNG', 'Chi tiết về HPG'], c)).toEqual(['HPG']);
    expect(link(['HPG TĂNG', 'Chi tiết'], c)).toEqual([]);
  });
});

describe('linkSymbols aliases', () => {
  const aliases = { HPG: ['Hòa Phát'], VNM: ['Vinamilk'], VIC: ['Vingroup'], VHM: ['Vingroup Holdings'] };
  const c = set('HPG', 'VNM', 'VIC', 'VHM');
  test('alias with and without diacritics (fold only when alias >= minFoldAliasChars)', () => {
    expect(link('Tập đoàn Hòa Phát báo lãi', c, aliases)).toEqual(['HPG']);
    expect(link('Tap doan Hoa Phat bao lai', c, aliases)).toEqual(['HPG']);
    expect(link('HOA PHAT', c, aliases)).toEqual(['HPG']);
    expect(link('Tân Á tăng', set('TAN'), { TAN: ['Tân Á'] })).toEqual(['TAN']);
    expect(link('Tan A tang', set('TAN'), { TAN: ['Tân Á'] })).toEqual([]);
  });
  test('longest alias wins on overlap; aliases are word-bounded', () => {
    expect(link('Vingroup Holdings công bố', c, aliases)).toEqual(['VHM']);
    expect(link('Vingroup công bố', c, aliases)).toEqual(['VIC']);
    expect(link('Vinamilkx và xVinamilk', c, aliases)).toEqual([]);
  });
  test('alias links only when its ticker is a candidate', () => {
    expect(link('Vinamilk', set('HPG'), aliases)).toEqual([]);
  });
});

describe('linkSymbols output', () => {
  test('sorted, unique, capped at maxSymbols (first appearances kept, then sorted)', () => {
    const names = Array.from({ length: 40 }, (_, i) => `A${String(i).padStart(2, '0')}`);
    const text = 'Tin: ' + [...names].reverse().join(' ') + ' A05 A05';
    const out = linkSymbols(text, { candidates: new Set(names), aliases: {}, config: { ...config, maxSymbols: 30 } });
    expect(out).toHaveLength(30);
    expect(out).toEqual([...out].sort());
    expect(out).toContain('A39');
    expect(out).not.toContain('A00');
    expect(new Set(out).size).toBe(30);
  });
  test('same input -> same output; no match -> empty list', () => {
    const c = set('HPG', 'VIC');
    expect(link('VIC và HPG', c)).toEqual(link('VIC và HPG', c));
    expect(link('', c)).toEqual([]);
  });
});
