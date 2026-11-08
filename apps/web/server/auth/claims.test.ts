import { describe, expect, it } from 'vitest';
import { checkClaims } from './claims';

const ID = '11111111-1111-4111-8111-111111111111';
const cfg = { issuer: 'https://abc.supabase.co/auth/v1' };
const NOW = 1_000_000;
const good = () => ({
  iss: cfg.issuer,
  aud: 'authenticated',
  role: 'authenticated',
  sub: ID,
  session_id: 'sess-1',
  exp: NOW + 3600,
});

describe('checkClaims', () => {
  it('ok for valid claims of an arbitrary sub', () => {
    const random = crypto.randomUUID();
    expect(checkClaims({ ...good(), sub: random }, cfg, NOW)).toEqual({ kind: 'ok', userId: random });
    const other = '22222222-2222-4222-8222-222222222222';
    expect(checkClaims({ ...good(), sub: other }, cfg, NOW)).toEqual({ kind: 'ok', userId: other });
  });

  it('sub is returned lowercased', () => {
    expect(checkClaims({ ...good(), sub: ID.toUpperCase() }, cfg, NOW)).toEqual({ kind: 'ok', userId: ID });
  });

  it('unauthenticated when exp is in the past or equals now', () => {
    expect(checkClaims({ ...good(), exp: NOW - 1 }, cfg, NOW).kind).toBe('unauthenticated');
    expect(checkClaims({ ...good(), exp: NOW }, cfg, NOW).kind).toBe('unauthenticated');
  });

  it('unauthenticated when exp is missing or not a number', () => {
    const noExp: Record<string, unknown> = good();
    delete noExp.exp;
    expect(checkClaims(noExp, cfg, NOW).kind).toBe('unauthenticated');
    expect(checkClaims({ ...good(), exp: '9999999' }, cfg, NOW).kind).toBe('unauthenticated');
  });

  it('unauthenticated when iss differs (incl. trailing slash / other project)', () => {
    expect(checkClaims({ ...good(), iss: `${cfg.issuer}/` }, cfg, NOW).kind).toBe('unauthenticated');
    expect(checkClaims({ ...good(), iss: 'https://other.supabase.co/auth/v1' }, cfg, NOW).kind).toBe('unauthenticated');
  });

  it('unauthenticated when aud lacks "authenticated" (string and array forms)', () => {
    expect(checkClaims({ ...good(), aud: 'other' }, cfg, NOW).kind).toBe('unauthenticated');
    expect(checkClaims({ ...good(), aud: ['other'] }, cfg, NOW).kind).toBe('unauthenticated');
    expect(checkClaims({ ...good(), aud: ['x', 'authenticated'] }, cfg, NOW).kind).toBe('ok');
  });

  it('unauthenticated when role is anon or service_role', () => {
    expect(checkClaims({ ...good(), role: 'anon' }, cfg, NOW).kind).toBe('unauthenticated');
    expect(checkClaims({ ...good(), role: 'service_role' }, cfg, NOW).kind).toBe('unauthenticated');
  });

  it('unauthenticated when sub is missing, empty or not a string', () => {
    expect(checkClaims({ ...good(), sub: undefined }, cfg, NOW).kind).toBe('unauthenticated');
    expect(checkClaims({ ...good(), sub: '' }, cfg, NOW).kind).toBe('unauthenticated');
    expect(checkClaims({ ...good(), sub: 42 }, cfg, NOW).kind).toBe('unauthenticated');
  });

  it('unauthenticated when is_anonymous is true; ok when it is false or absent', () => {
    expect(checkClaims({ ...good(), is_anonymous: true }, cfg, NOW).kind).toBe('unauthenticated');
    expect(checkClaims({ ...good(), is_anonymous: false }, cfg, NOW).kind).toBe('ok');
    expect(checkClaims(good(), cfg, NOW).kind).toBe('ok');
  });

  it('unauthenticated when session_id is missing, empty or not a string', () => {
    expect(checkClaims({ ...good(), session_id: undefined }, cfg, NOW).kind).toBe('unauthenticated');
    expect(checkClaims({ ...good(), session_id: '' }, cfg, NOW).kind).toBe('unauthenticated');
    expect(checkClaims({ ...good(), session_id: 7 }, cfg, NOW).kind).toBe('unauthenticated');
  });

  it('unauthenticated for null/undefined/non-object claims', () => {
    for (const c of [null, undefined, 'x', 5]) expect(checkClaims(c, cfg, NOW).kind).toBe('unauthenticated');
  });
});
