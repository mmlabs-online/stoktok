import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import { getSymbolExchanges, listSymbolSectors, setSymbolExchange, setSymbolSector } from './symbols';

describe('getSymbolExchanges', () => {
  test('empty input -> {} with no query', async () => {
    const f = createFake();
    expect(await getSymbolExchanges(f.db, [])).toEqual({});
    expect(f.calls).toHaveLength(0);
  });
  test('one .in() call; null exchange kept; symbols without a row omitted', async () => {
    const f = createFake();
    f.respond({ data: [{ symbol: 'VNM', exchange: 'HOSE' }, { symbol: 'FPT', exchange: null }] });
    const out = await getSymbolExchanges(f.db, ['VNM', 'FPT', 'HPG']);
    expect(f.methods('in')).toHaveLength(1);
    expect(f.methods('in')[0]?.args).toEqual(['symbol', ['VNM', 'FPT', 'HPG']]);
    expect(out).toEqual({ VNM: 'HOSE', FPT: null });
  });
  test('invalid stored exchange -> MAPPING', async () => {
    const f = createFake();
    f.respond({ data: [{ symbol: 'VNM', exchange: 'HSX' }] });
    await expect(getSymbolExchanges(f.db, ['VNM'])).rejects.toMatchObject({ code: 'MAPPING' });
  });
  test('DB error -> DataError', async () => {
    const f = createFake();
    f.respond({ error: { code: '42501' } });
    await expect(getSymbolExchanges(f.db, ['VNM'])).rejects.toMatchObject({ code: 'DB_ERROR' });
  });
});

describe('setSymbolExchange', () => {
  test('upserts {symbol, exchange, updated_at} on conflict symbol', async () => {
    const f = createFake();
    f.respond({});
    await setSymbolExchange(f.db, 'VNM', 'HNX');
    const [payload, opts] = f.methods('upsert')[0]?.args ?? [];
    expect(payload).toMatchObject({ symbol: 'VNM', exchange: 'HNX' });
    expect(typeof (payload as { updated_at: unknown }).updated_at).toBe('string');
    expect(opts).toEqual({ onConflict: 'symbol' });
    expect(f.methods('select')).toHaveLength(0);
  });
  test('null exchange writes null', async () => {
    const f = createFake();
    f.respond({});
    await setSymbolExchange(f.db, 'VNM', null);
    expect(f.methods('upsert')[0]?.args[0]).toMatchObject({ exchange: null });
  });
  test('error -> DataError', async () => {
    const f = createFake();
    f.respond({ error: { code: '23514' } });
    await expect(setSymbolExchange(f.db, 'VNM', null)).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('setSymbolSector', () => {
  test('payload keys are exactly symbol, sector, sector_source, sector_fetched_at, updated_at (no exchange)', async () => {
    const f = createFake();
    f.respond({});
    await setSymbolSector(f.db, 'VNM', { sector: 'Thực phẩm', source: 'tcbs-public', fetchedAt: '2026-10-26T00:00:00.000Z' });
    const [payload, opts] = f.methods('upsert')[0]?.args ?? [];
    expect(Object.keys(payload as object).sort()).toEqual(['sector', 'sector_fetched_at', 'sector_source', 'symbol', 'updated_at']);
    expect(opts).toEqual({ onConflict: 'symbol' });
  });
  test('setSymbolExchange payload has no sector keys', async () => {
    const f = createFake();
    f.respond({});
    await setSymbolExchange(f.db, 'VNM', 'HOSE');
    expect(Object.keys(f.methods('upsert')[0]?.args[0] as object).sort()).toEqual(['exchange', 'symbol', 'updated_at']);
  });
  test('error -> DataError', async () => {
    const f = createFake();
    f.respond({ error: { code: '23514' } });
    await expect(setSymbolSector(f.db, 'VNM', { sector: 'x', source: 's', fetchedAt: 't' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('listSymbolSectors', () => {
  test('in(symbols), maps provenance, null sector kept, symbols without a row omitted', async () => {
    const f = createFake();
    f.respond({
      data: [
        { symbol: 'A', sector: 'Banks', sector_source: 's', sector_fetched_at: '2026-10-25T00:00:00.000Z' },
        { symbol: 'B', sector: null, sector_source: null, sector_fetched_at: null },
      ],
    });
    const out = await listSymbolSectors(f.db, ['A', 'B', 'C']);
    expect(f.methods('in')[0]?.args).toEqual(['symbol', ['A', 'B', 'C']]);
    expect(out).toEqual({
      A: { sector: 'Banks', source: 's', fetchedAt: '2026-10-25T00:00:00.000Z' },
      B: { sector: null, source: null, fetchedAt: null },
    });
  });
  test('sector without source -> MAPPING', async () => {
    const f = createFake();
    f.respond({ data: [{ symbol: 'A', sector: 'Banks', sector_source: null, sector_fetched_at: null }] });
    await expect(listSymbolSectors(f.db, ['A'])).rejects.toMatchObject({ code: 'MAPPING' });
  });
  test('empty -> no call', async () => {
    const f = createFake();
    expect(await listSymbolSectors(f.db, [])).toEqual({});
    expect(f.calls).toHaveLength(0);
  });
});
