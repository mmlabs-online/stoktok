import { describe, expect, test } from 'vitest';
import { createServiceClient } from './client';

describe('createServiceClient', () => {
  test('throws naming the missing variable without echoing values', () => {
    expect(() => createServiceClient({ SUPABASE_SERVICE_ROLE_KEY: 'KEYVALUE' })).toThrow('Missing env SUPABASE_URL');
    let msg = '';
    try {
      createServiceClient({ SUPABASE_URL: 'http://urlvalue.test' });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toBe('Missing env SUPABASE_SERVICE_ROLE_KEY');
    expect(msg).not.toContain('urlvalue');
  });

  test('returns a client given both vars', () => {
    const c = createServiceClient({ SUPABASE_URL: 'http://localhost', SUPABASE_SERVICE_ROLE_KEY: 'k' });
    expect(typeof c.from).toBe('function');
  });
});
