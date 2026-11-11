import { expect, test } from 'vitest';
import type { PgDb } from '../pg/client';
import { extendGaps, insertGaps, listOpenGaps, resolveGaps } from './data-gaps';

const noDb = {} as PgDb;

test('empty input returns without a query', async () => {
  expect(await listOpenGaps(noDb, 'prices', [])).toEqual([]);
  await expect(insertGaps(noDb, [])).resolves.toBeUndefined();
  await expect(resolveGaps(noDb, [], '2026-11-10T00:00:00+00:00')).resolves.toBeUndefined();
  await expect(extendGaps(noDb, [], '2026-11-10T00:00:00+00:00')).resolves.toBeUndefined();
});
