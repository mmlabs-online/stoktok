import { expect, test } from 'vitest';
import type { PgDb } from '../pg/client';
import { getLatestIntraday, upsertPricesIntraday } from './prices-intraday';

const noDb = {} as PgDb;

test('empty symbols give {} and empty rows write nothing (no query)', async () => {
  expect(await getLatestIntraday(noDb, [])).toEqual({});
  expect(await upsertPricesIntraday(noDb, [])).toBe(0);
});
