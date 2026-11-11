import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { kyselyOf } from '../src/pg/access';
import { getSymbolExchanges, listSymbolSectors, setSymbolExchange, setSymbolSector } from '../src/repos/symbols';
import { freshDb, type TestDb } from './harness';

let t: TestDb;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  await t.drop();
});

const raw = (symbol: string) => kyselyOf(t.pgDb).selectFrom('symbols').selectAll().where('symbol', '=', symbol).executeTakeFirstOrThrow();

describe('symbols repo', () => {
  test('exchange upsert: insert, overwrite, null overwrites; symbols without a row omitted', async () => {
    await setSymbolExchange(t.pgDb, 'EX1', 'HOSE');
    await setSymbolExchange(t.pgDb, 'EX2', null);
    expect(await getSymbolExchanges(t.pgDb, ['EX1', 'EX2', 'NOPE'])).toEqual({ EX1: 'HOSE', EX2: null });
    await setSymbolExchange(t.pgDb, 'EX1', 'HNX');
    expect((await getSymbolExchanges(t.pgDb, ['EX1']))['EX1']).toBe('HNX');
    await setSymbolExchange(t.pgDb, 'EX1', null);
    expect((await getSymbolExchanges(t.pgDb, ['EX1']))['EX1']).toBeNull();
  });

  test('setSymbolSector writes only sector columns and never touches exchange (conflict key symbol)', async () => {
    await setSymbolExchange(t.pgDb, 'SE', 'UPCOM');
    await setSymbolSector(t.pgDb, 'SE', { sector: 'Ngân hàng', source: 'vnd', fetchedAt: '2026-11-08T00:00:00+00:00' });
    const r = await raw('SE');
    expect(r).toMatchObject({ exchange: 'UPCOM', sector: 'Ngân hàng', sector_source: 'vnd', sector_fetched_at: '2026-11-08T00:00:00+00:00' });
  });

  test('setSymbolExchange does not touch sector columns', async () => {
    await setSymbolSector(t.pgDb, 'SX', { sector: 'Thép', source: 'vnd', fetchedAt: '2026-11-08T00:00:00+00:00' });
    await setSymbolExchange(t.pgDb, 'SX', 'HOSE');
    expect(await raw('SX')).toMatchObject({ exchange: 'HOSE', sector: 'Thép', sector_source: 'vnd' });
  });

  test('a new sector row gets exchange NULL; updated_at is set', async () => {
    await setSymbolSector(t.pgDb, 'NW', { sector: 'Dầu khí', source: 'vnd', fetchedAt: '2026-11-08T00:00:00+00:00' });
    const r = await raw('NW');
    expect(r.exchange).toBeNull();
    expect(r.updated_at).toBeTruthy();
  });

  test('listSymbolSectors maps provenance; symbols without a row omitted; empty → {}', async () => {
    await setSymbolExchange(t.pgDb, 'LS', 'HOSE');
    const out = await listSymbolSectors(t.pgDb, ['SE', 'LS', 'NOPE']);
    expect(out['SE']).toEqual({ sector: 'Ngân hàng', source: 'vnd', fetchedAt: '2026-11-08T00:00:00+00:00' });
    expect(out['LS']).toEqual({ sector: null, source: null, fetchedAt: null });
    expect(out['NOPE']).toBeUndefined();
    expect(await listSymbolSectors(t.pgDb, [])).toEqual({});
  });

  test('a sector without provenance is rejected by the database → VALIDATION', async () => {
    await setSymbolExchange(t.pgDb, 'BADQ', 'HOSE');
    await expect(setSymbolSector(t.pgDb, 'BADQ', { sector: '', source: 'vnd', fetchedAt: '2026-11-08T00:00:00+00:00' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
