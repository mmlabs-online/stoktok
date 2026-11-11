import { expect, test } from 'vitest';
import type { PgDb } from '../pg/client';
import { listFinancials, upsertFinancials } from './financials';

const noDb = {} as PgDb;

test('empty symbols give [] and empty rows write nothing (no query)', async () => {
  expect(await listFinancials(noDb, [], '2025Q1')).toEqual([]);
  expect(await upsertFinancials(noDb, [])).toBe(0);
});
