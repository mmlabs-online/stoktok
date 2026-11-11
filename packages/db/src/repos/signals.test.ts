import { expect, test } from 'vitest';
import type { PgDb } from '../pg/client';
import { listLatestSignals, upsertSignals } from './signals';

const noDb = {} as PgDb;

test('no rule ids give [] and empty rows write nothing (no query)', async () => {
  expect(await listLatestSignals(noDb, 'AAA', [])).toEqual([]);
  expect(await upsertSignals(noDb, [])).toBe(0);
});
