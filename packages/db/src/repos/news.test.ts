import { expect, test } from 'vitest';
import type { PgDb } from '../pg/client';
import { insertNews } from './news';

test('empty input inserts nothing and runs no query', async () => {
  expect(await insertNews({} as PgDb, [])).toBe(0);
});
