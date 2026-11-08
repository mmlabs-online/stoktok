import { describe, expect, test } from 'vitest';
import { NEWS_SYNC_CONFIG } from '../config';
import { createNewsSources } from './news-source';
import type { NewsSource } from './news-source';

const http = { timeoutMs: 1000, maxAttempts: 1, backoffBaseMs: 0, sleep: async () => undefined, log: () => undefined };
const rss = '<rss version="2.0"><channel><item><title>t</title><link>https://cafef.vn/a</link></item></channel></rss>';

describe('createNewsSources', () => {
  test('builds the three configured sources', () => {
    const sources = createNewsSources(NEWS_SYNC_CONFIG, { fetchImpl: fetch, http });
    expect(sources.map((s) => s.id)).toEqual(['cafef', 'vietstock', 'vnexpress']);
    const first: NewsSource | undefined = sources[0];
    expect(first).toMatchObject({ name: 'CafeF', credibility: 'established_outlet', upgradeHttps: true });
    expect(first?.feedUrls).toEqual(NEWS_SYNC_CONFIG.sources[0]?.feedUrls);
  });
  test('skips a disabled source', () => {
    const config = { ...NEWS_SYNC_CONFIG, sources: NEWS_SYNC_CONFIG.sources.map((s) => (s.id === 'vietstock' ? { ...s, enabled: false } : s)) };
    expect(createNewsSources(config, { fetchImpl: fetch, http }).map((s) => s.id)).toEqual(['cafef', 'vnexpress']);
  });
  test('fetchFeed uses getText with the source UA and rss Accept', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return new Response(rss, { status: 200 });
    }) as unknown as typeof fetch;
    const source = createNewsSources(NEWS_SYNC_CONFIG, { fetchImpl, http })[0] as NewsSource;
    const items = await source.fetchFeed('https://cafef.vn/x.rss');
    expect(items).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('https://cafef.vn/x.rss');
    expect(calls[0]?.[1]?.headers).toEqual({ 'User-Agent': NEWS_SYNC_CONFIG.userAgent, Accept: 'application/rss+xml, application/xml' });
    expect(calls[0]?.[1]?.redirect).toBe('error');
  });
  test('a failing request surfaces as an error', async () => {
    const fetchImpl = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
    const source = createNewsSources(NEWS_SYNC_CONFIG, { fetchImpl, http })[0] as NewsSource;
    await expect(source.fetchFeed('https://cafef.vn/x.rss')).rejects.toMatchObject({ status: 403 });
  });
});
