import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NEWS_LINK_CONFIG, NEWS_SYMBOL_ALIASES, linkSymbols, normalizeNewsItem } from '@stoktok/core';
import { describe, expect, test } from 'vitest';
import { NEWS_SYNC_CONFIG } from '../config';
import type { NewsSourceId } from '../config';
import { createNewsSources } from './news-source';

const FETCHED_AT = '2026-11-09T01:00:00.000Z';
const read = (id: NewsSourceId) => readFileSync(join(__dirname, '__fixtures__', 'news', `${id}.xml`), 'utf8');
const candidates = new Set<string>([...Object.keys(NEWS_SYMBOL_ALIASES), 'FPT']);

async function run(id: NewsSourceId) {
  const fetchImpl = (async () => new Response(read(id), { status: 200 })) as unknown as typeof fetch;
  const source = createNewsSources(NEWS_SYNC_CONFIG, {
    fetchImpl,
    http: { timeoutMs: 1000, maxAttempts: 1, backoffBaseMs: 0, sleep: async () => undefined, log: () => undefined },
  }).find((s) => s.id === id);
  if (!source) throw new Error('source missing');
  const raws = await source.fetchFeed(source.feedUrls[0] as string);
  const results = raws.map((r) =>
    normalizeNewsItem(r, {
      source: source.name,
      credibility: source.credibility,
      linkHosts: source.linkHosts,
      upgradeHttps: source.upgradeHttps,
      fetchedAt: FETCHED_AT,
      maxTitleChars: NEWS_SYNC_CONFIG.maxTitleChars,
      maxExcerptChars: NEWS_SYNC_CONFIG.maxExcerptChars,
      maxFutureMs: NEWS_SYNC_CONFIG.maxFutureMs,
    }),
  );
  const items = results.flatMap((r) => (r.ok ? [{ ...r.item, symbols: linkSymbols([r.item.title, r.item.excerpt], { candidates, aliases: NEWS_SYMBOL_ALIASES, config: NEWS_LINK_CONFIG }) }] : []));
  return { raws, results, items };
}

describe.each(['cafef', 'vietstock', 'vnexpress'] as const)('%s synthetic fixture', (id) => {
  test('all items normalize, dates in UTC, no "<" in excerpts, links canonical', async () => {
    const { raws, results, items } = await run(id);
    expect(raws).toHaveLength(5);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    for (const it of items) {
      expect(it.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
      expect(Date.parse(it.publishedAt)).toBeLessThanOrEqual(Date.parse(FETCHED_AT));
      expect(it.excerpt).not.toContain('<');
      expect(it.title).not.toContain('<');
      expect(it.title).toBe(it.title.normalize('NFC'));
      expect(it.excerpt).toBe(it.excerpt.normalize('NFC'));
      expect(`${it.title} ${it.excerpt}`).not.toMatch(/&[A-Za-z]+;|&#\d+;/);
      expect(it.url).toMatch(/^https:\/\//);
      expect(it.url).not.toMatch(/utm_|#|\/$/);
      expect(it.source).toBe(NEWS_SYNC_CONFIG.sources.find((s) => s.id === id)?.name);
      expect(it.credibility).toBe('established_outlet');
      expect(it.fetchedAt).toBe(FETCHED_AT);
    }
    expect(new Set(items.map((i) => i.url)).size).toBe(5);
  });
});

describe('fixture specifics', () => {
  test('CafeF: 2-digit year in UTC, http upgraded, tracking dropped, symbols linked, script gone', async () => {
    const { items } = await run('cafef');
    expect(items[0]?.publishedAt).toBe('2026-11-08T13:54:00.000Z');
    expect(items[0]?.symbols).toEqual(['HPG', 'VIC']);
    expect(items[1]?.url).toBe('https://cafef.vn/lai-suat-huy-dong-188261108190000002.chn');
    expect(items[1]?.symbols).toEqual(['VCB']);
    expect(items[2]?.symbols).toEqual([]);
    expect(items[3]?.symbols).toEqual(['VNM']);
    expect(items[3]?.excerpt).toBe('Doanh thu thuần đạt 16.000 tỷ đồng.');
    expect(items[4]?.excerpt).toBe('');
  });
  test('CafeF: a decomposed (NFD) title is stored as NFC', async () => {
    const { raws, items } = await run('cafef');
    expect(raws[2]?.title).not.toBe(raws[2]?.title.normalize('NFC'));
    expect(items[2]?.title).toBe('VN-Index đi ngang trong phiên cuối tuần'.normalize('NFC'));
  });
  test('Vietstock: escaped markup stripped, XML and HTML entities decoded in turn, id param kept', async () => {
    const { items } = await run('vietstock');
    expect(items[0]?.excerpt).toBe('Tập đoàn FPT công bố kết quả kinh doanh tháng 10.');
    expect(items[0]?.symbols).toEqual(['FPT']);
    expect(items[1]?.excerpt).toBe('Giá tăng 3% trong phiên, P/E ở mức 12 & thanh khoản cao.');
    expect(items[2]?.excerpt).toBe('Giao dịch thực hiện theo phương thức khớp lệnh.');
    expect(items[3]?.excerpt).toBe('Ngày giao dịch không hưởng quyền là 20/11.');
    expect(items[1]?.symbols).toEqual(['HPG']);
    expect(items[3]?.url).toBe('https://vietstock.vn/2026/11/co-tuc-738-1100004.htm?id=4');
  });
  test('VnExpress: items arrive unsorted and the stored data keeps each date', async () => {
    const { items } = await run('vnexpress');
    expect(items.map((i) => i.publishedAt)).not.toEqual([...items.map((i) => i.publishedAt)].sort());
    expect(items[1]?.symbols).toEqual(['VIC']);
    expect(items[0]?.excerpt).toBe('Giá vàng SJC giảm 200.000 đồng mỗi lượng.');
  });
});
