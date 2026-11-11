import { describe, expect, test } from 'vitest';
import { RowMappingError } from '@stoktok/core';
import { DataError, fetchAll, run, toDataError, unwrap } from './errors';

const ctx = { table: 't', op: 'o' };

describe('errors', () => {
  test('unwrap: error → DB_ERROR, 23514 → VALIDATION, null data without error → DB_ERROR', () => {
    expect(() => unwrap({ data: null, error: {} }, ctx)).toThrow(expect.objectContaining({ code: 'DB_ERROR' }));
    expect(() => unwrap({ data: null, error: { code: '23514' } }, ctx)).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
    expect(() => unwrap({ data: null, error: null }, ctx)).toThrow(expect.objectContaining({ code: 'DB_ERROR' }));
    expect(unwrap({ data: [1], error: null }, ctx)).toEqual([1]);
  });

  test('DataError message contains table, op, pg code but not error.details/message payload', () => {
    let err: unknown;
    try {
      unwrap({ data: null, error: { code: '23505', message: 'SECRET-PAYLOAD', details: 'SECRET-DETAIL' } as never }, ctx);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DataError);
    const msg = (err as DataError).message;
    expect(msg).toContain('t.o');
    expect(msg).toContain('23505');
    expect(msg).not.toContain('SECRET');
  });

  test('fetchAll stops on a short page', async () => {
    const pages = [[1, 2], [3]];
    const ranges: number[][] = [];
    const out = await fetchAll(
      async (from, to) => {
        ranges.push([from, to]);
        return { data: pages.shift() ?? [], error: null };
      },
      ctx,
      2,
    );
    expect(out).toEqual([1, 2, 3]);
    expect(ranges).toEqual([
      [0, 1],
      [2, 3],
    ]);
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
});
