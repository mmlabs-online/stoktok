import { describe, expect, test } from 'vitest';
import { createFake } from '../../test/fake-client';
import { DataError } from '../errors';
import { deleteAiKey, listAiKeyMeta, readAiKeySecrets, saveAiKey } from './ai-keys';

const SENTINEL = 'DUMMY-SENTINEL-not-a-real-key-0000';

async function caught(p: Promise<unknown>): Promise<DataError> {
  try {
    await p;
  } catch (e) {
    return e as DataError;
  }
  throw new Error('expected rejection');
}

function expectNoSecret(err: DataError) {
  expect(err).toBeInstanceOf(DataError);
  expect(err.message).not.toContain('SENTINEL');
  expect(String(err)).not.toContain('SENTINEL');
  expect(JSON.stringify(err)).not.toContain('SENTINEL');
  expect(err.cause).toBeUndefined();
}

describe('saveAiKey', () => {
  test("calls rpc ai_key_set with {p_provider, p_key} and maps {key_last4, saved_at}", async () => {
    const f = createFake();
    f.respond({ data: [{ key_last4: '0000', saved_at: '2026-11-10T01:00:00Z' }] });
    const meta = await saveAiKey(f.db, 'google', SENTINEL);
    expect(f.methods('rpc')[0]).toEqual({ table: 'ai_key_set', method: 'rpc', args: [{ p_provider: 'google', p_key: SENTINEL }] });
    expect(meta).toEqual({ provider: 'google', last4: '0000', updatedAt: '2026-11-10T01:00:00Z' });
    expect(JSON.stringify(meta)).not.toContain('SENTINEL');
  });

  test('an invalid format throws VALIDATION without calling rpc; the message has no key', async () => {
    const f = createFake();
    const err = await caught(saveAiKey(f.db, 'google', `${SENTINEL} with space`));
    expect(err.code).toBe('VALIDATION');
    expectNoSecret(err);
    expect(f.calls).toEqual([]);
  });

  test('an rpc error throws a DataError with no sentinel and no cause', async () => {
    const f = createFake();
    f.respond({ error: { code: '22023', message: `bad ${SENTINEL}`, details: SENTINEL } });
    const err = await caught(saveAiKey(f.db, 'google', SENTINEL));
    expect(err.code).toBe('VALIDATION');
    expect(err.pgCode).toBe('22023');
    expectNoSecret(err);
  });

  test('a non-22023 rpc error is DB_ERROR with no sentinel', async () => {
    const f = createFake();
    f.respond({ error: { code: '42501', message: SENTINEL } });
    const err = await caught(saveAiKey(f.db, 'anthropic', SENTINEL));
    expect(err.code).toBe('DB_ERROR');
    expectNoSecret(err);
  });

  test('rejects a provider outside AI_PROVIDERS without calling rpc', async () => {
    const f = createFake();
    const err = await caught(saveAiKey(f.db, 'openai', SENTINEL));
    expect(err.code).toBe('VALIDATION');
    expectNoSecret(err);
    expect(f.calls).toEqual([]);
  });
});

describe('deleteAiKey', () => {
  test('calls ai_key_delete and returns the boolean', async () => {
    const f = createFake();
    f.respond({ data: true });
    f.respond({ data: false });
    expect(await deleteAiKey(f.db, 'google')).toBe(true);
    expect(await deleteAiKey(f.db, 'google')).toBe(false);
    expect(f.methods('rpc')[0]).toEqual({ table: 'ai_key_delete', method: 'rpc', args: [{ p_provider: 'google' }] });
  });

  test('rejects an unknown provider without calling rpc', async () => {
    const f = createFake();
    expect((await caught(deleteAiKey(f.db, 'openai'))).code).toBe('VALIDATION');
    expect(f.calls).toEqual([]);
  });
});

describe('listAiKeyMeta', () => {
  test('selects exactly provider, last4, updated_at from ai_keys and maps rows', async () => {
    const f = createFake();
    f.respond({ data: [{ provider: 'anthropic', last4: 'abcd', updated_at: '2026-11-10T01:00:00Z' }] });
    expect(await listAiKeyMeta(f.db)).toEqual([{ provider: 'anthropic', last4: 'abcd', updatedAt: '2026-11-10T01:00:00Z' }]);
    expect(f.calls[0]).toEqual({ table: 'ai_keys', method: 'select', args: ['provider, last4, updated_at'] });
  });
});

describe('readAiKeySecrets', () => {
  test('maps [{provider, secret}] to {anthropic?, google?}; empty gives {}', async () => {
    const f = createFake();
    f.respond({ data: [{ provider: 'anthropic', secret: 'A' }, { provider: 'google', secret: 'G' }] });
    f.respond({ data: [] });
    expect(await readAiKeySecrets(f.db)).toEqual({ anthropic: 'A', google: 'G' });
    expect(await readAiKeySecrets(f.db)).toEqual({});
    expect(f.methods('rpc')[0]).toEqual({ table: 'ai_key_secrets', method: 'rpc', args: [undefined] });
  });

  test('an unknown provider row throws MAPPING with no secret in message or cause', async () => {
    const f = createFake();
    f.respond({ data: [{ provider: 'openai', secret: SENTINEL }] });
    const err = await caught(readAiKeySecrets(f.db));
    expect(err.code).toBe('MAPPING');
    expectNoSecret(err);
  });

  test('an rpc error throws a DataError with no cause and no sentinel', async () => {
    const f = createFake();
    f.respond({ error: { code: 'XX000', message: SENTINEL } });
    expectNoSecret(await caught(readAiKeySecrets(f.db)));
  });
});
