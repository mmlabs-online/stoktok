import { describe, expect, test } from 'vitest';
import { dedupeNewsItems, normalizeNewsItem } from './normalize-item';
import type { NormalizeNewsOptions } from './normalize-item';
import type { NewsItem, RawFeedItem } from './types';

const opts: NormalizeNewsOptions = {
  source: 'CafeF',
  credibility: 'established_outlet',
  linkHosts: ['cafef.vn'],
  upgradeHttps: true,
  fetchedAt: '2026-11-08T14:00:00.000Z',
  maxTitleChars: 20,
  maxExcerptChars: 10,
  maxFutureMs: 86_400_000,
};
const raw = (o: Partial<RawFeedItem> = {}): RawFeedItem => ({
  title: 'Tiêu đề',
  link: 'http://cafef.vn/a-1.chn',
  guid: '',
  pubDate: 'Sun, 08 Nov 26 20:54:00 +0700',
  description: '<p>Mô tả</p>',
  ...o,
});

describe('normalizeNewsItem', () => {
  test('builds NewsItem with source, credibility, fetched_at', () => {
    expect(normalizeNewsItem(raw(), opts)).toEqual({
      ok: true,
      item: {
        url: 'https://cafef.vn/a-1.chn',
        title: 'Tiêu đề',
        excerpt: 'Mô tả',
        source: 'CafeF',
        credibility: 'established_outlet',
        publishedAt: '2026-11-08T13:54:00.000Z',
        fetchedAt: '2026-11-08T14:00:00.000Z',
        symbols: [],
      },
    });
  });
  test('falls back to guid when link is empty', () => {
    const r = normalizeNewsItem(raw({ link: '', guid: 'https://cafef.vn/g-2.chn' }), opts);
    expect(r.ok && r.item.url).toBe('https://cafef.vn/g-2.chn');
  });
  test('rejects: bad_date, future_date, empty_title, bad_url', () => {
    expect(normalizeNewsItem(raw({ pubDate: 'soon' }), opts)).toEqual({ ok: false, reason: 'bad_date' });
    expect(normalizeNewsItem(raw({ pubDate: 'Tue, 10 Nov 2026 20:54:00 +0700' }), opts)).toEqual({ ok: false, reason: 'future_date' });
    expect(normalizeNewsItem(raw({ title: '<b> </b>' }), opts)).toEqual({ ok: false, reason: 'empty_title' });
    expect(normalizeNewsItem(raw({ link: 'javascript:x' }), opts)).toEqual({ ok: false, reason: 'bad_url' });
  });
  test('caps title at maxTitleChars and excerpt at maxExcerptChars on a code point', () => {
    const r = normalizeNewsItem(raw({ title: '😀'.repeat(30), description: 'a'.repeat(50) }), opts);
    expect(r.ok && Array.from(r.item.title).length).toBe(20);
    expect(r.ok && r.item.excerpt).toBe('a'.repeat(10));
  });
  test('excerpt comes from description through toPlainText; image markup never stored', () => {
    const r = normalizeNewsItem(raw({ description: '<img src="https://x/y.jpg"><script>x()</script>Hi' }), { ...opts, maxExcerptChars: 100 });
    expect(r.ok && r.item.excerpt).toBe('Hi');
  });
});

describe('dedupeNewsItems', () => {
  test('keeps the first occurrence per url and is order-stable', () => {
    const it = (url: string, title: string): NewsItem => ({ url, title, excerpt: '', source: 's', credibility: 'established_outlet', publishedAt: 'p', fetchedAt: 'f', symbols: [] });
    const out = dedupeNewsItems([it('u1', 'a'), it('u2', 'b'), it('u1', 'c'), it('u3', 'd')]);
    expect(out.map((i) => i.title)).toEqual(['a', 'b', 'd']);
  });
});
