import { describe, expect, test } from 'vitest';
import { canonicalNewsUrl } from './canonical-url';

const o = { linkHosts: ['cafef.vn'], upgradeHttps: true };

describe('canonicalNewsUrl', () => {
  test('forces https when upgradeHttps, lowercases host, drops fragment', () => {
    expect(canonicalNewsUrl('http://CafeF.VN/a-1.chn#x', o)).toBe('https://cafef.vn/a-1.chn');
    expect(canonicalNewsUrl('http://cafef.vn/a', { ...o, upgradeHttps: false })).toBe('http://cafef.vn/a');
  });
  test('drops utm_*, fbclid, gclid; sorts remaining params; keeps other params', () => {
    expect(canonicalNewsUrl('https://cafef.vn/a?z=1&utm_source=x&fbclid=2&gclid=3&b=2&ref=feed', o)).toBe('https://cafef.vn/a?b=2&ref=feed&z=1');
    expect(canonicalNewsUrl('https://cafef.vn/a?utm_medium=x', o)).toBe('https://cafef.vn/a');
  });
  test('strips trailing slash on non-root path; keeps root', () => {
    expect(canonicalNewsUrl('https://cafef.vn/a/b/', o)).toBe('https://cafef.vn/a/b');
    expect(canonicalNewsUrl('https://cafef.vn/', o)).toBe('https://cafef.vn/');
  });
  test('rejects non-http(s) schemes (javascript:, data:) and hosts not in linkHosts', () => {
    expect(canonicalNewsUrl('javascript:alert(1)', o)).toBeNull();
    expect(canonicalNewsUrl('data:text/html,x', o)).toBeNull();
    expect(canonicalNewsUrl('https://evil.example/a', o)).toBeNull();
    expect(canonicalNewsUrl('https://cafef.vn.evil.example/a', o)).toBeNull();
    expect(canonicalNewsUrl('https://user:pw@cafef.vn/a', o)).toBeNull();
    expect(canonicalNewsUrl('not a url', o)).toBeNull();
    expect(canonicalNewsUrl('https://s.cafef.vn/a', o)).toBe('https://s.cafef.vn/a');
  });
  test('rejects > 2048 chars; same article from two feeds -> same url', () => {
    expect(canonicalNewsUrl(`https://cafef.vn/${'a'.repeat(2100)}`, o)).toBeNull();
    expect(canonicalNewsUrl('', o)).toBeNull();
    expect(canonicalNewsUrl('https://cafef.vn/a?utm_source=rss', o)).toBe(canonicalNewsUrl('http://cafef.vn/a/', o));
  });
});
