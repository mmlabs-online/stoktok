import { describe, expect, test } from 'vitest';
import type { PgDb } from '../pg/client';
import { getFirstPriceDates, getLatestCloses, getRecentCloses, upsertPricesDaily } from './prices-daily';

// Not a PgDb: any query attempt rejects with DB_ERROR, so these results prove that no query ran.
const noDb = {} as PgDb;

describe('prices-daily without a query', () => {
  test('empty symbols give {} and empty rows write nothing', async () => {
    expect(await getLatestCloses(noDb, [])).toEqual({});
    expect(await getFirstPriceDates(noDb, [])).toEqual({});
    expect(await getRecentCloses(noDb, [])).toEqual({});
    expect(await upsertPricesDaily(noDb, [])).toBe(0);
  });

  test('a query attempt on a non-handle rejects with DB_ERROR', async () => {
    await expect(getLatestCloses(noDb, ['AAA'])).rejects.toMatchObject({ code: 'DB_ERROR' });
  });
});
