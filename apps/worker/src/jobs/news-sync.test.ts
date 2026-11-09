import type { RawFeedItem } from '@stoktok/core';
import type { DataGapInsert, NewsInsert, OpenGapRecord } from '@stoktok/db';
import { SourceError } from '@stoktok/sources';
import { describe, expect, test } from 'vitest';
import { NEWS_SYNC_CONFIG } from '../config';
import type { NewsSource } from '../sources/news-source';
import { runNewsSync } from './news-sync';
import type { NewsStore } from './news-sync';

const MON = new Date('2026-11-09T03:00:00.000Z'); // Monday 10:00 VN
const SAT = new Date('2026-11-07T03:00:00.000Z');

const item = (n: number, o: Partial<RawFeedItem> = {}): RawFeedItem => ({
  title: `Tin ${n} HPG`,
  link: `https://cafef.vn/a-${n}.chn`,
  guid: '',
  pubDate: 'Mon, 09 Nov 2026 09:00:00 +0700',
  description: `<p>Mo ta ${n}</p>`,
  ...o,
});

function source(id: 'cafef' | 'vietstock' | 'vnexpress', feeds: Record<string, RawFeedItem[] | Error>, host = 'cafef.vn'): NewsSource & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    id,
    name: id.toUpperCase(),
    credibility: 'established_outlet',
    feedUrls: Object.keys(feeds),
    linkHosts: [host],
    upgradeHttps: true,
    minIntervalMs: 3000,
    fetched,
    async fetchFeed(url) {
      fetched.push(url);
      const r = feeds[url];
      if (r instanceof Error) throw r;
      return r ?? [];
    },
  };
}

function setup(o: { held?: Awaited<ReturnType<NewsStore['listHeldSymbols']>>; openGaps?: Record<string, OpenGapRecord[]>; holidays?: string[] } = {}) {
  const order: string[] = [];
  const rows: NewsInsert[] = [];
  const gaps: DataGapInsert[] = [];
  const extended: { ids: number[]; to: string }[] = [];
  const resolved: number[][] = [];
  const logs: string[] = [];
  const sleeps: number[] = [];
  const store: NewsStore = {
    getHolidays: async () => o.holidays ?? [],
    listWatchlistSymbols: async () => ['HPG'],
    listHeldSymbols: async () => o.held ?? { ok: true, value: [] },
    insertNews: async (r) => {
      order.push('insertNews');
      rows.push(...r);
      return r.length;
    },
    listOpenGaps: async (s) => o.openGaps?.[s] ?? [],
    insertGaps: async (r) => {
      order.push('insertGaps');
      gaps.push(...r);
    },
    extendGaps: async (ids, to) => void extended.push({ ids, to }),
    resolveGaps: async (ids) => void resolved.push(ids),
  };
  const run = (sources: NewsSource[], extra: { now?: Date; dryRun?: boolean } = {}) =>
    runNewsSync({ store, sources, now: extra.now ?? MON, config: NEWS_SYNC_CONFIG, sleep: async (ms) => void sleeps.push(ms), log: (m) => void logs.push(m), dryRun: extra.dryRun ?? false });
  return { run, order, rows, gaps, extended, resolved, logs, sleeps };
}

const gap = (id: number): OpenGapRecord => ({ id, symbol: null, fromTs: '2026-11-09T01:00:00.000Z', toTs: '2026-11-09T02:00:00.000Z' });

describe('runNewsSync', () => {
  test('skips on a non-trading day without fetching (ok true, skipped: "non_trading_day")', async () => {
    const s = setup();
    const src = source('cafef', { 'https://cafef.vn/f1.rss': [item(1)] });
    const out = await s.run([src], { now: SAT });
    expect(out).toMatchObject({ ok: true, skipped: 'non_trading_day' });
    expect(src.fetched).toEqual([]);
    expect(s.order).toEqual([]);
    const h = setup({ holidays: ['2026-11-09'] });
    expect(await h.run([src])).toMatchObject({ skipped: 'non_trading_day' });
  });
  test('stores items with source, credibility, fetched_at and linked symbols', async () => {
    const s = setup();
    const out = await s.run([source('cafef', { 'https://cafef.vn/f1.rss': [item(1), item(2, { title: 'Khong ma nao' })] })]);
    expect(out).toMatchObject({ ok: true, itemsInserted: 2, failedSources: [] });
    expect(s.rows[0]).toEqual({
      url: 'https://cafef.vn/a-1.chn',
      title: 'Tin 1 HPG',
      excerpt: 'Mo ta 1',
      source: 'CAFEF',
      credibility: 'established_outlet',
      published_at: '2026-11-09T02:00:00.000Z',
      fetched_at: MON.toISOString(),
      symbols: ['HPG'],
    });
    expect(s.rows[1]?.symbols).toEqual([]);
  });
  test('sleeps minIntervalMs between feeds of one source, sources sequential', async () => {
    const s = setup();
    const a = source('cafef', { 'https://cafef.vn/f1.rss': [item(1)], 'https://cafef.vn/f2.rss': [item(2)], 'https://cafef.vn/f3.rss': [item(3)] });
    await s.run([a, source('vnexpress', { 'https://vnexpress.net/x.rss': [item(4, { link: 'https://vnexpress.net/a-4.html' })] }, 'vnexpress.net')]);
    expect(s.sleeps).toEqual([3000, 3000]);
    expect(a.fetched).toHaveLength(3);
  });
  test('stops a source after maxConsecutiveFeedFailures, others continue', async () => {
    const s = setup();
    const err = new SourceError('HTTP 503', true, 503);
    const a = source('cafef', { 'https://cafef.vn/f1.rss': err, 'https://cafef.vn/f2.rss': err, 'https://cafef.vn/f3.rss': [item(3)] });
    const b = source('vnexpress', { 'https://vnexpress.net/x.rss': [item(4, { link: 'https://vnexpress.net/a-4.html' })] }, 'vnexpress.net');
    const out = await s.run([a, b]);
    expect(a.fetched).toEqual(['https://cafef.vn/f1.rss', 'https://cafef.vn/f2.rss']);
    expect(out.perSource.cafef).toMatchObject({ feeds: 2, failedFeeds: 2, skippedFeeds: 1 });
    expect(out.itemsInserted).toBe(1);
    expect(out.failedSources).toEqual(['cafef']);
  });
  test('dedupes items by canonical url within the batch', async () => {
    const s = setup();
    const out = await s.run([
      source('cafef', {
        'https://cafef.vn/f1.rss': [item(1), item(2)],
        'https://cafef.vn/f2.rss': [item(1, { link: 'http://cafef.vn/a-1.chn?utm_source=rss' })],
      }),
    ]);
    expect(out).toMatchObject({ duplicatesInBatch: 1, itemsInserted: 2 });
    expect(s.rows.map((r) => r.url)).toEqual(['https://cafef.vn/a-1.chn', 'https://cafef.vn/a-2.chn']);
  });
  test('rejected items are counted by reason and not stored', async () => {
    const s = setup();
    const out = await s.run([source('cafef', { 'https://cafef.vn/f1.rss': [item(1), item(2, { pubDate: 'x' }), item(3, { link: 'https://evil.example/a' }), item(4, { title: '' })] })]);
    expect(out.perSource.cafef?.rejectedByReason).toEqual({ bad_date: 1, bad_url: 1, empty_title: 1 });
    expect(out.perSource.cafef?.items).toBe(1);
    expect(s.rows).toHaveLength(1);
  });
  test('one source throws: others stored, gap recorded for it, ok false', async () => {
    const s = setup();
    const bad = source('cafef', { 'https://cafef.vn/f1.rss': new SourceError('HTTP 403', false, 403) });
    const good = source('vnexpress', { 'https://vnexpress.net/x.rss': [item(4, { link: 'https://vnexpress.net/a-4.html' })] }, 'vnexpress.net');
    const out = await s.run([bad, good]);
    expect(out).toMatchObject({ ok: false, itemsInserted: 1, gapsRecorded: 1, failedSources: ['cafef'] });
    expect(s.gaps).toEqual([{ symbol: null, data_type: 'news', from_ts: '2026-11-09T02:00:00.000Z', to_ts: MON.toISOString(), source: 'cafef', fetched_at: MON.toISOString() }]);
  });
  test('200 with zero valid items counts as a feed failure (gap)', async () => {
    const s = setup();
    const out = await s.run([source('cafef', { 'https://cafef.vn/f1.rss': [item(1, { pubDate: 'x' })] })]);
    expect(out).toMatchObject({ ok: false, gapsRecorded: 1, failedSources: ['cafef'] });
  });
  test('open gap is extended, not duplicated', async () => {
    const s = setup({ openGaps: { cafef: [gap(5), gap(8)] } });
    const out = await s.run([source('cafef', { 'https://cafef.vn/f1.rss': new Error('boom') })]);
    expect(s.gaps).toEqual([]);
    expect(s.extended).toEqual([{ ids: [8], to: MON.toISOString() }]);
    expect(out).toMatchObject({ gapsRecorded: 0, gapsExtended: 1, ok: false });
  });
  test("success resolves the source's open gaps", async () => {
    const s = setup({ openGaps: { cafef: [gap(5), gap(8)], vnexpress: [gap(9)] } });
    const out = await s.run([source('cafef', { 'https://cafef.vn/f1.rss': [item(1)] })]);
    expect(s.resolved).toEqual([[5, 8]]);
    expect(out).toMatchObject({ ok: true, gapsResolved: 2 });
  });
  test('rows written before gaps (call order)', async () => {
    const s = setup();
    await s.run([source('cafef', { 'https://cafef.vn/f1.rss': new Error('x') }), source('vnexpress', { 'https://vnexpress.net/x.rss': [item(4, { link: 'https://vnexpress.net/a-4.html' })] }, 'vnexpress.net')]);
    expect(s.order).toEqual(['insertNews', 'insertGaps']);
  });
  test('dry-run writes nothing but reports counts', async () => {
    const s = setup({ openGaps: { cafef: [gap(5)] } });
    const out = await s.run([source('cafef', { 'https://cafef.vn/f1.rss': [item(1), item(2)] })], { dryRun: true });
    expect(s.order).toEqual([]);
    expect(s.resolved).toEqual([]);
    expect(out).toMatchObject({ ok: true, dryRun: true, itemsInserted: 0 });
    expect(out.perSource.cafef?.items).toBe(2);
  });
  test('links against watchlist + held + alias symbols; held-symbols ledger error -> ok false, still runs', async () => {
    const s = setup({ held: { ok: true, value: ['FPT'] } });
    await s.run([source('cafef', { 'https://cafef.vn/f1.rss': [item(1, { title: 'FPT va Vinamilk cung tang' })] })]);
    expect(s.rows[0]?.symbols).toEqual(['FPT', 'VNM']);
    const e = setup({ held: { ok: false, error: { code: 'LEDGER_X' } } as never });
    const out = await e.run([source('cafef', { 'https://cafef.vn/f1.rss': [item(1)] })]);
    expect(out).toMatchObject({ ok: false, ledgerError: 'LEDGER_X', itemsInserted: 1 });
  });
  test('never logs titles or excerpts', async () => {
    const s = setup();
    await s.run([source('cafef', { 'https://cafef.vn/f1.rss': new Error('failure text'), 'https://cafef.vn/f2.rss': [item(1, { title: 'SECRET-TITLE', description: 'SECRET-EXCERPT' })] })]);
    expect(s.logs.length).toBeGreaterThan(0);
    expect(s.logs.join('\n')).not.toMatch(/SECRET/);
  });
});
