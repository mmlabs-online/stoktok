import { describe, expect, test } from 'vitest';
import { DataError, fetchAll, unwrap } from './errors';

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
});
