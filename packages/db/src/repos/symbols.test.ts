import { expect, test } from 'vitest';
import type { PgDb } from '../pg/client';
import { getSymbolExchanges, listSymbolSectors } from './symbols';

const noDb = {} as PgDb;

test('empty symbols give {} (no query)', async () => {
  expect(await getSymbolExchanges(noDb, [])).toEqual({});
  expect(await listSymbolSectors(noDb, [])).toEqual({});
});
