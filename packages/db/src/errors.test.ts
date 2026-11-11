import { describe, expect, test } from 'vitest';
import { RowMappingError } from '@stoktok/core';
import { DataError, found, run, toDataError } from './errors';

const ctx = { table: 't', op: 'o' };

describe('errors', () => {
  test('found returns the row; undefined throws NOT_FOUND with table.op and no cause', () => {
    expect(found({ a: 1 }, ctx)).toEqual({ a: 1 });
    expect(found(null, ctx)).toBeNull();
    let err: unknown;
    try {
      found(undefined, ctx);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DataError);
    expect(err).toMatchObject({ code: 'NOT_FOUND', table: 't', op: 'o' });
    expect((err as DataError).message).toBe('t.o: not found');
    expect((err as DataError).cause).toBeUndefined();
  });

  test('toDataError maps 23505 → CONFLICT; 23502, 23514, 22P02 → VALIDATION; 40001 → DB_ERROR', () => {
    expect(toDataError({ code: '23505' }, ctx)).toMatchObject({ code: 'CONFLICT', pgCode: '23505' });
    for (const code of ['23502', '23514', '22P02']) expect(toDataError({ code }, ctx)).toMatchObject({ code: 'VALIDATION', pgCode: code });
    expect(toDataError({ code: '40001' }, ctx)).toMatchObject({ code: 'DB_ERROR', pgCode: '40001' });
  });

  test('toDataError: non-SQLSTATE code (ECONNREFUSED) → DB_ERROR without pgCode', () => {
    const e = toDataError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }), ctx);
    expect(e).toMatchObject({ code: 'DB_ERROR' });
    expect(e.pgCode).toBeUndefined();
  });

  test('toDataError: message never contains err.message, err.detail, host or password; no cause', () => {
    const raw = Object.assign(new Error('connect ECONNREFUSED db.host.test:5432 pw-secret'), {
      code: '23505',
      detail: 'Key (url)=(https://secret.test) already exists.',
    });
    const e = toDataError(raw, ctx);
    expect(e.message).toBe('t.o: conflict [23505]');
    expect(e.cause).toBeUndefined();
  });

  test('toDataError passes DataError through unchanged; RowMappingError → MAPPING', () => {
    const d = new DataError('NOT_FOUND', 't', 'o', 'not found');
    expect(toDataError(d, ctx)).toBe(d);
    expect(toDataError(new RowMappingError('t', 'f', 'bad'), ctx)).toMatchObject({ code: 'MAPPING' });
  });

  test('only real SQLSTATEs are mapped; Node errno codes are not', () => {
    for (const code of ['EPIPE', 'EPERM', 'ECONNRESET', 'ABC']) {
      expect(toDataError(Object.assign(new Error('x'), { code }), ctx).pgCode).toBeUndefined();
    }
    for (const code of ['XX000', 'HV000', '08006']) {
      expect(toDataError(Object.assign(new Error('x'), { code }), ctx).pgCode).toBe(code);
    }
  });

  test('run() resolves the value and rethrows mapped', async () => {
    await expect(run(ctx, async () => 5)).resolves.toBe(5);
    await expect(run(ctx, async () => Promise.reject(Object.assign(new Error('x'), { code: '23505' })))).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('run() map overrides the code and keeps pgCode, text from the code, no cause', async () => {
    const boom = Object.assign(new Error('SECRET'), { code: '22023' });
    const err = (await run(ctx, () => Promise.reject(boom), { map: (c) => (c === '22023' ? 'VALIDATION' : undefined) }).catch((e: unknown) => e)) as DataError;
    expect(err).toMatchObject({ code: 'VALIDATION', pgCode: '22023' });
    expect(err.message).toBe('t.o: validation failed [22023]');
    expect(err.cause).toBeUndefined();
  });

  test('map returning undefined falls back to the default mapping', async () => {
    const boom = Object.assign(new Error('x'), { code: '23505' });
    await expect(run(ctx, () => Promise.reject(boom), { map: () => undefined })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
