import { describe, expect, it } from 'vitest';
import { loginPath, safeNext } from './login-path';

describe('safeNext / loginPath', () => {
  it('keeps a relative path with query', () => {
    expect(safeNext('/transactions?page=2')).toBe('/transactions?page=2');
    expect(loginPath('/transactions?page=2')).toBe('/login?next=%2Ftransactions%3Fpage%3D2');
    expect(loginPath('/')).toBe('/login');
  });

  it('replaces //evil, /\\evil, https://evil, javascript:, empty and /login with /', () => {
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '', '/login', '/login?next=/x', null, undefined, 5]) {
      expect(safeNext(bad)).toBe('/');
    }
  });

  it('rejects paths that normalize to a protocol-relative URL', () => {
    for (const bad of ['/.//evil.com', '/%2e//evil.com', '/%2E%2E//evil.com', '/a/..//evil.com']) {
      expect(safeNext(bad)).toBe('/');
    }
  });

  it('rejects control chars, whitespace and backslash anywhere', () => {
    for (const bad of ['/\t/evil.com', '/\x0b/evil.com', '/ /evil.com', '/\n/evil.com', '/\r/evil.com', '/\x00/evil.com', '/a\\b']) {
      expect(safeNext(bad)).toBe('/');
    }
  });
});
