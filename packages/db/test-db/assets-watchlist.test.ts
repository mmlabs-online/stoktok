import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DataError } from '../src/errors';
import { createAsset, deleteAsset, getAsset, listAssets, updateAsset } from '../src/repos/assets';
import { addToWatchlist, listWatchlist, removeFromWatchlist } from '../src/repos/watchlist';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

const err = async (p: Promise<unknown>) => {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(DataError);
  return e as DataError;
};
const ID = '00000000-0000-4000-8000-000000000000';

describe('assets repo', () => {
  test('CRUD; value arrives as a digit string and maps to a number', async () => {
    const a = await createAsset(t.pgDb, { type: 'cash', name: 'TCBS cash', value: 12_000_000_000, asOf: '2026-11-01' });
    expect(a).toMatchObject({ type: 'cash', value: 12_000_000_000, asOf: '2026-11-01' });
    expect(await getAsset(t.pgDb, a.id)).toEqual(a);
    const u = await updateAsset(t.pgDb, a.id, { type: 'other', name: 'Gold', value: 5, asOf: '2026-11-02' });
    expect(u).toMatchObject({ id: a.id, type: 'other', name: 'Gold', value: 5 });
    await deleteAsset(t.pgDb, a.id);
    expect((await err(getAsset(t.pgDb, a.id))).code).toBe('NOT_FOUND');
  });

  test('delete, get and update of a missing id → NOT_FOUND', async () => {
    expect((await err(deleteAsset(t.pgDb, ID))).code).toBe('NOT_FOUND');
    expect((await err(getAsset(t.pgDb, ID))).code).toBe('NOT_FOUND');
    expect((await err(updateAsset(t.pgDb, ID, { type: 'cash', name: 'x', value: 1, asOf: '2026-11-01' }))).code).toBe('NOT_FOUND');
  });

  test('ordering as_of desc, id; a check violation → VALIDATION', async () => {
    const mk = (name: string, asOf: string) => createAsset(t.pgDb, { type: 'cash', name, value: 1, asOf });
    await mk('old', '2026-01-01');
    await mk('new', '2026-12-01');
    const names = (await listAssets(t.pgDb)).map((a) => a.name);
    expect(names.indexOf('new')).toBeLessThan(names.indexOf('old'));
    expect((await err(createAsset(t.pgDb, { type: 'cash', name: 'neg', value: -1, asOf: '2026-11-01' }))).code).toBe('VALIDATION');
  });
});

describe('watchlist repo', () => {
  test('add uses the default group_name; list is ordered by symbol', async () => {
    const b = await addToWatchlist(t.pgDb, 'BBB');
    await addToWatchlist(t.pgDb, 'AAA');
    expect(b).toMatchObject({ symbol: 'BBB', group: 'watching' });
    expect((await listWatchlist(t.pgDb)).map((w) => w.symbol)).toEqual(['AAA', 'BBB']);
  });

  test('duplicate → CONFLICT, bad symbol → VALIDATION, remove missing → NOT_FOUND', async () => {
    expect((await err(addToWatchlist(t.pgDb, 'AAA'))).code).toBe('CONFLICT');
    expect((await err(addToWatchlist(t.pgDb, 'bad symbol'))).code).toBe('VALIDATION');
    await removeFromWatchlist(t.pgDb, 'AAA');
    expect((await err(removeFromWatchlist(t.pgDb, 'AAA'))).code).toBe('NOT_FOUND');
  });
});
