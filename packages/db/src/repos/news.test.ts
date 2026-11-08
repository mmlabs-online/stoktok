import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import type { NewsInsert } from '../rows';
import { insertNews } from './news';

const row = (n: number): NewsInsert => ({
  url: `https://cafef.vn/a-${n}.chn`,
  title: `t${n}`,
  excerpt: '',
  source: 'CafeF',
  credibility: 'established_outlet',
  published_at: '2026-11-08T13:54:00.000Z',
  fetched_at: '2026-11-08T14:00:00.000Z',
  symbols: [],
});
const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

describe('insertNews', () => {
  test('upserts with onConflict url + ignoreDuplicates, chunked by chunkSize, returns inserted count', async () => {
    const f = createFake();
    f.respond({ data: ids(2) });
    f.respond({ data: ids(1) });
    expect(await insertNews(f.db, [row(1), row(2), row(3)], { chunkSize: 2 })).toBe(3);
    const ups = f.methods('upsert');
    expect(ups[0]?.args[1]).toEqual({ onConflict: 'url', ignoreDuplicates: true });
    expect(f.methods('select').map((c) => c.args)).toEqual([['id'], ['id']]);
    expect(f.methods('in')).toHaveLength(0);
  });
  test('rows already stored are not counted', async () => {
    const f = createFake();
    f.respond({ data: ids(1) });
    expect(await insertNews(f.db, [row(1), row(2)])).toBe(1);
  });
  test('2 x chunkSize + 1 rows -> 3 requests, each <= chunkSize', async () => {
    const f = createFake();
    for (let i = 0; i < 3; i++) f.respond({ data: [] });
    await insertNews(f.db, Array.from({ length: 401 }, (_, i) => row(i)), { chunkSize: 200 });
    const sizes = f.methods('upsert').map((c) => (c.args[0] as unknown[]).length);
    expect(sizes).toEqual([200, 200, 1]);
  });
  test('empty -> no call', async () => {
    const f = createFake();
    expect(await insertNews(f.db, [])).toBe(0);
    expect(f.calls).toHaveLength(0);
  });
  test('error maps to DataError, no payload in the message', async () => {
    const f = createFake();
    f.respond({ error: { code: '23514' } });
    const err = await insertNews(f.db, [row(1)]).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'VALIDATION' });
    expect((err as Error).message).not.toContain('cafef');
    const g = createFake();
    g.respond({ error: { code: '42501' } });
    await expect(insertNews(g.db, [row(1)])).rejects.toMatchObject({ code: 'DB_ERROR' });
  });
});
