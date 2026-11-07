import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { loadAuthConfig } = await import('./config');

const base = () => ({
  AUTHEN_SUPABASE_URL: 'https://abc.supabase.co',
  AUTHEN_SUPABASE_ANON_KEY: 'anon',
});

describe('loadAuthConfig', () => {
  it('loads with ALLOWLIST_USER_IDS unset or set to junk (ignored)', () => {
    const expected = { supabaseUrl: 'https://abc.supabase.co', anonKey: 'anon', issuer: 'https://abc.supabase.co/auth/v1' };
    expect(loadAuthConfig(base())).toEqual(expected);
    expect(loadAuthConfig({ ...base(), ALLOWLIST_USER_IDS: 'not-a-uuid' })).toEqual(expected);
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
