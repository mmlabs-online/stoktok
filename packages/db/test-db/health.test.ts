import { describe, expect, test } from 'vitest';
import { DataError } from '../src/errors';
import { createPgDb, DATABASE_URL_ENV } from '../src/pg/client';
import { pingDb } from '../src/repos/health';
import { freshDb } from './harness';

describe('pingDb', () => {
  test('resolves on a fresh database', async () => {
    const t = await freshDb('web');
    try {
      await expect(pingDb(t.pgDb)).resolves.toBeUndefined();
    } finally {
      await t.drop();
    }
  });

  test('rejects with DataError DB_ERROR and no host or password in the message', async () => {
    const db = createPgDb({ [DATABASE_URL_ENV]: 'postgres://u:pw-SENTINEL@127.0.0.1:1/x' }, 'web');
    try {
      const err = await pingDb(db).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DataError);
      expect(err).toMatchObject({ code: 'DB_ERROR' });
      expect((err as Error).message).not.toContain('pw-SENTINEL');
      expect((err as Error).message).not.toContain('127.0.0.1');
    } finally {
      await db.end().catch(() => undefined);
    }
  });
});
