import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { describe, expect, test } from 'vitest';
import type { Database } from './schema';
import { chunkForParams, jsonb, upsertInto } from './upsert';

const db = new Kysely<Database>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (d) => new PostgresIntrospector(d),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

const price = { symbol: 'AAA', trade_date: '2026-11-10', open: 1, high: 2, low: 1, close: 2, volume: 5, source: 's', fetched_at: 't' };

describe('upsertInto', () => {
  test('do update set lists provided non-conflict columns from excluded', () => {
    const { sql } = upsertInto(db, 'prices_daily', [price], ['symbol', 'trade_date']).compile();
    expect(sql).toContain('on conflict ("symbol", "trade_date") do update set');
    expect(sql).toContain('"open" = "excluded"."open"');
    expect(sql).toContain('"fetched_at" = "excluded"."fetched_at"');
    expect(sql).not.toMatch(/"symbol" = "excluded"/);
    expect(sql).not.toContain('foreign_net');
  });

  test('ignoreDuplicates compiles to on conflict do nothing', () => {
    const row = { url: 'https://x', title: 't', source: 's', credibility: 'official_disclosure', published_at: 'p', fetched_at: 'f' };
    const { sql } = upsertInto(db, 'news', [row], ['url'], { ignoreDuplicates: true }).compile();
    expect(sql).toContain('on conflict ("url") do nothing');
    expect(sql).not.toContain('do update');
  });

  test('only conflict columns provided → do nothing', () => {
    const { sql } = upsertInto(db, 'watchlist', [{ symbol: 'AAA' }], ['symbol']).compile();
    expect(sql).toContain('do nothing');
  });

  test('rows with different key sets throw; undefined values count as absent', () => {
    expect(() => upsertInto(db, 'prices_daily', [price, { ...price, foreign_net: 1 }], ['symbol', 'trade_date'])).toThrow(/different columns/);
    expect(() => upsertInto(db, 'prices_daily', [price, { ...price, foreign_net: undefined }], ['symbol', 'trade_date'])).not.toThrow();
  });

  test('conflict column not in the row keys throws', () => {
    expect(() => upsertInto(db, 'prices_daily', [{ ...price, trade_date: undefined } as never], ['symbol', 'trade_date'])).toThrow(/conflict column trade_date/);
  });
});

describe('upsert guards', () => {
  test('non identifier-shaped column names throw before any SQL is built', () => {
    for (const k of ['excluded.x', 'a"b', 'Open', 'a b', '1a']) {
      expect(() => upsertInto(db, 'prices_daily', [{ ...price, [k]: 1 } as never], ['symbol', 'trade_date']), k).toThrow(/invalid column name/);
    }
  });

  test('jsonb(undefined) throws; arrays and objects compile', () => {
    expect(() => jsonb(undefined)).toThrow(/undefined/);
    expect(() => jsonb([1])).not.toThrow();
    expect(() => jsonb({ a: 1 })).not.toThrow();
  });
});

describe('jsonb typing', () => {
  test('jsonb columns reject raw objects at compile time', () => {
    const base = { symbol: 'A', rule_id: 'r', horizon: 'h', signal_date: 'd', status: 's', data_fresh: false, rule_version: 1, computed_at: 't' };
    // @ts-expect-error a raw object is not accepted on a jsonb column
    db.insertInto('signals').values({ ...base, inputs_snapshot: { a: 1 } });
    expect(() => db.insertInto('signals').values({ ...base, inputs_snapshot: jsonb({ a: 1 }) })).not.toThrow();
  });
});

describe('chunkForParams', () => {
  test('splits at floor(maxParams / ncols) rows', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ a: i, b: i, c: i }));
    expect(chunkForParams(rows, 7).map((c) => c.length)).toEqual([2, 2, 2, 1]);
    expect(chunkForParams([], 7)).toEqual([]);
    expect(chunkForParams(rows).length).toBe(1);
  });
});
