import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { loadAuthConfig } = await import('./config');

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = 'AAAAAAAA-2222-4222-8222-222222222222';
const base = () => ({
  AUTHEN_SUPABASE_URL: 'https://abc.supabase.co',
  AUTHEN_SUPABASE_ANON_KEY: 'anon',
  ALLOWLIST_USER_IDS: U1,
});

describe('loadAuthConfig', () => {
  it('parses ALLOWLIST_USER_IDS trimming spaces, dropping empties, lowercasing', () => {
    const cfg = loadAuthConfig({ ...base(), ALLOWLIST_USER_IDS: ` ${U1} , ,${U2},` });
    expect([...cfg.allowlist]).toEqual([U1, U2.toLowerCase()]);
  });

  it('throws when ALLOWLIST_USER_IDS is empty, unset or has a non-UUID', () => {
    expect(() => loadAuthConfig({ ...base(), ALLOWLIST_USER_IDS: '' })).toThrow();
    expect(() => loadAuthConfig({ ...base(), ALLOWLIST_USER_IDS: ' , ' })).toThrow();
    expect(() => loadAuthConfig({ ...base(), ALLOWLIST_USER_IDS: undefined })).toThrow();
    expect(() => loadAuthConfig({ ...base(), ALLOWLIST_USER_IDS: `${U1},ming` })).toThrow();
  });

  it('throws when AUTHEN_SUPABASE_URL is missing, not https, or has a path', () => {
    for (const url of [undefined, '', 'http://abc.supabase.co', 'https://abc.supabase.co/', 'https://abc.supabase.co/auth/v1']) {
      expect(() => loadAuthConfig({ ...base(), AUTHEN_SUPABASE_URL: url })).toThrow();
    }
  });

  it('throws when AUTHEN_SUPABASE_ANON_KEY is missing', () => {
    expect(() => loadAuthConfig({ ...base(), AUTHEN_SUPABASE_ANON_KEY: undefined })).toThrow();
    expect(() => loadAuthConfig({ ...base(), AUTHEN_SUPABASE_ANON_KEY: ' ' })).toThrow();
  });

  it('derives issuer as <url>/auth/v1', () => {
    expect(loadAuthConfig(base()).issuer).toBe('https://abc.supabase.co/auth/v1');
  });
});
