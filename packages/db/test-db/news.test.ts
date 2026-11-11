import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { kyselyOf } from '../src/pg/access';
import { insertNews } from '../src/repos/news';
import type { NewsInsert } from '../src/rows';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

const item = (n: number | string, o: Partial<NewsInsert> = {}): NewsInsert => ({
  url: `https://news.test/${n}`,
  title: `Title ${n}`,
  excerpt: '',
  source: 'rss',
  credibility: 'established_outlet',
  published_at: '2026-11-10T00:00:00+00:00',
  fetched_at: '2026-11-10T01:00:00+00:00',
  symbols: [],
  ...o,
});
const rows = () => kyselyOf(t.pgDb).selectFrom('news').selectAll().orderBy('id').execute();

describe('news repo', () => {
  test('new url inserted and counted; existing url skipped, title unchanged, not counted', async () => {
    expect(await insertNews(t.pgDb, [item('a')])).toBe(1);
    expect(await insertNews(t.pgDb, [item('a', { title: 'Changed' }), item('b')])).toBe(1);
    const all = (await rows()).filter((r) => /\/(a|b)$/.test(r.url));
    expect(all.map((r) => r.title)).toEqual(['Title a', 'Title b']);
  });

  test('in-batch duplicate counts once; chunkSize 2 sums across chunks', async () => {
    expect(await insertNews(t.pgDb, [item('d'), item('d')])).toBe(1);
    expect(await insertNews(t.pgDb, [item('e1'), item('e2'), item('e3'), item('e4'), item('e5')], { chunkSize: 2 })).toBe(5);
  });

  test('symbols text[] round-trips incl. []', async () => {
    await insertNews(t.pgDb, [item('s1', { symbols: ['FPT', 'VNM'] }), item('s2', { symbols: [] })]);
    const r = (await rows()).filter((x) => /\/s[12]$/.test(x.url));
    expect(r.map((x) => x.symbols)).toEqual([['FPT', 'VNM'], []]);
  });

  test('a failing later chunk keeps earlier chunks (no transaction) and throws VALIDATION', async () => {
    const err = await insertNews(t.pgDb, [item('f1'), item('f2'), item('f3', { title: '' })], { chunkSize: 2 }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'VALIDATION' });
    expect((await rows()).filter((r) => /\/f[123]$/.test(r.url)).map((r) => r.url)).toEqual(['https://news.test/f1', 'https://news.test/f2']);
  });

  test('empty input does nothing', async () => {
    const before = (await rows()).length;
    expect(await insertNews(t.pgDb, [])).toBe(0);
    expect((await rows()).length).toBe(before);
  });
});
