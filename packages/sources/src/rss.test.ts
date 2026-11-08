import { describe, expect, test } from 'vitest';
import { parseRssFeed } from './rss';
import { SourceError } from './source-error';

const feed = (items: string, head = '<?xml version="1.0" encoding="utf-8"?>') =>
  `${head}<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>T</title><atom:link href="x" rel="self"/>${items}</channel></rss>`;
const item = (n: number) =>
  `<item><title><![CDATA[Tin ${n} &amp; HPG]]></title><link>https://cafef.vn/a-${n}.chn</link><guid isPermaLink="true">https://cafef.vn/a-${n}.chn</guid><pubDate>Sun, 08 Nov 26 20:54:00 +0700</pubDate><description><![CDATA[<p>Mô tả ${n}</p>]]></description><content:encoded><![CDATA[x]]></content:encoded><media:content url="https://x/i.jpg"/></item>`;

describe('parseRssFeed', () => {
  test('parses RSS 2.0 items (title, link, guid, pubDate, description) with CDATA', () => {
    const out = parseRssFeed(feed(item(1) + item(2)), { maxItems: 10 });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      title: 'Tin 1 &amp; HPG',
      link: 'https://cafef.vn/a-1.chn',
      guid: 'https://cafef.vn/a-1.chn',
      pubDate: 'Sun, 08 Nov 26 20:54:00 +0700',
      description: '<p>Mô tả 1</p>',
    });
  });
  test('a single item and missing optional fields', () => {
    const out = parseRssFeed(feed('<item><title>Only</title><link>https://x/1</link></item>'), { maxItems: 10 });
    expect(out).toEqual([{ title: 'Only', link: 'https://x/1', guid: '', pubDate: '', description: '' }]);
  });
  test('namespaced feed (atom/content/media) parses', () => {
    expect(parseRssFeed(feed(item(1)), { maxItems: 10 })).toHaveLength(1);
  });
  test('escaped markup in a description is returned as text, not parsed', () => {
    const out = parseRssFeed(feed('<item><title>t</title><link>https://x/1</link><description>&lt;p&gt;Hi&lt;/p&gt;</description></item>'), { maxItems: 10 });
    expect(out[0]?.description).toBe('<p>Hi</p>');
  });
  test('rejects a document containing <!DOCTYPE (entity expansion)', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY a "aaaa">]>${feed(item(1), '')}`;
    expect(() => parseRssFeed(xml, { maxItems: 10 })).toThrow(SourceError);
  });
  test('rejects a non-UTF-8 encoding declaration; accepts a missing declaration', () => {
    expect(() => parseRssFeed(feed(item(1), '<?xml version="1.0" encoding="windows-1258"?>'), { maxItems: 10 })).toThrow(/UTF-8/);
    expect(parseRssFeed(feed(item(1), ''), { maxItems: 10 })).toHaveLength(1);
    expect(parseRssFeed(feed(item(1), "<?xml version='1.0' encoding='UTF8'?>"), { maxItems: 10 })).toHaveLength(1);
  });
  test('malformed XML / no <channel> / zero items -> non-retryable SourceError', () => {
    for (const xml of ['<rss><channel><item>', 'not xml', '<rss version="2.0"></rss>', feed('')]) {
      const err = (() => {
        try {
          parseRssFeed(xml, { maxItems: 10 });
        } catch (e) {
          return e;
        }
      })();
      expect(err, xml).toBeInstanceOf(SourceError);
      expect(err, xml).toMatchObject({ retryable: false });
    }
  });
  test('truncates to maxItems', () => {
    expect(parseRssFeed(feed(item(1) + item(2) + item(3)), { maxItems: 2 })).toHaveLength(2);
  });
});
