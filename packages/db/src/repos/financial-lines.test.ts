import { expect, test } from 'vitest';
import type { PgDb } from '../pg/client';
import { listFinancialLines, upsertFinancialLines } from './financial-lines';

const noDb = {} as PgDb;

test('empty symbols give [] and empty rows write nothing (no query)', async () => {
  expect(await listFinancialLines(noDb, [], 'quarter', '2025Q1')).toEqual([]);
  expect(await upsertFinancialLines(noDb, [])).toBe(0);
});
