import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { COOKIE_OPTIONS } = await import('./authen-client');

describe('auth cookie options', () => {
  it('cookie options are httpOnly, sameSite lax, path /, no domain, name stoktok-auth', () => {
    expect(COOKIE_OPTIONS).toMatchObject({ name: 'stoktok-auth', httpOnly: true, sameSite: 'lax', path: '/' });
    expect('domain' in COOKIE_OPTIONS).toBe(false);
  });
});
