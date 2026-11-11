import { describe, expect, test } from 'vitest';
import { DataError } from '../errors';
import type { PgDb } from '../pg/client';
import { deleteAiKey, saveAiKey } from './ai-keys';

// Not a PgDb: any query attempt would reject with DB_ERROR, so VALIDATION proves that no query ran.
const noDb = {} as PgDb;
const SENTINEL = 'DUMMY-SENTINEL-not-a-real-key-0000';

async function caught(p: Promise<unknown>): Promise<DataError> {
  try {
    await p;
  } catch (e) {
    return e as DataError;
  }
  throw new Error('expected rejection');
}

describe('ai-keys input validation (no query attempted)', () => {
  test('an invalid format throws VALIDATION; the message has no key', async () => {
    const err = await caught(saveAiKey(noDb, 'google', `${SENTINEL} with space`));
    expect(err).toBeInstanceOf(DataError);
    expect(err.code).toBe('VALIDATION');
    expect(String(err) + JSON.stringify(err)).not.toContain('SENTINEL');
    expect(err.cause).toBeUndefined();
  });

  test('an unknown provider throws VALIDATION for save and delete', async () => {
    const err = await caught(saveAiKey(noDb, 'openai', SENTINEL));
    expect(err.code).toBe('VALIDATION');
    expect(String(err)).not.toContain('SENTINEL');
    expect((await caught(deleteAiKey(noDb, 'openai'))).code).toBe('VALIDATION');
  });
});
