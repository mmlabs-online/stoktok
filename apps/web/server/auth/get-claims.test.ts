import { createClient } from '@supabase/supabase-js';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';
import { checkClaims } from './claims';

const URL_ = 'https://test.supabase.co';
const ISS = `${URL_}/auth/v1`;
const ID = '11111111-1111-4111-8111-111111111111';
const cfg = { issuer: ISS, allowlist: new Set([ID]) };

async function keyPair() {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  return { privateKey, jwk: { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' } };
}

function sign(privateKey: CryptoKey | Uint8Array, alg: string, exp: string | number = '1h') {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg, kid: 'k1', typ: 'JWT' })
    .setIssuer(ISS)
    .setAudience('authenticated')
    .setSubject(ID)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
    .setExpirationTime(exp)
    .sign(privateKey);
}

function clientFor(jwk: object, userStatus = 200) {
  const fakeFetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
    if (url.endsWith('/auth/v1/user')) {
      return userStatus === 200
        ? Response.json({ id: ID })
        : Response.json({ message: 'invalid JWT' }, { status: userStatus });
    }
    return new Response('not found', { status: 404 });
  };
  return createClient(URL_, 'anon', { global: { fetch: fakeFetch as typeof fetch }, auth: { persistSession: false } });
}

const now = () => Math.floor(Date.now() / 1000);

describe('supabase-js getClaims with a local JWKS', () => {
  it('getClaims(jwt) accepts an ES256 token signed by the served JWKS key', async () => {
    const { privateKey, jwk } = await keyPair();
    const { data, error } = await clientFor(jwk).auth.getClaims(await sign(privateKey, 'ES256'));
    expect(error).toBeNull();
    expect(checkClaims(data?.claims, cfg, now())).toEqual({ kind: 'ok', userId: ID });
  });

  it('getClaims(jwt) errors for a token signed by a different key', async () => {
    const a = await keyPair();
    const b = await keyPair();
    const { data, error } = await clientFor(a.jwk).auth.getClaims(await sign(b.privateKey, 'ES256'));
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('expired ES256 token ends as unauthenticated (getClaims error or checkClaims exp)', async () => {
    const { privateKey, jwk } = await keyPair();
    const { data, error } = await clientFor(jwk).auth.getClaims(await sign(privateKey, 'ES256', now() - 60));
    expect(error ? 'unauthenticated' : checkClaims(data?.claims, cfg, now()).kind).toBe('unauthenticated');
  });

  it('HS256 token falls back to /auth/v1/user and a 401 there ends as unauthenticated', async () => {
    const secret = new TextEncoder().encode('s'.repeat(32));
    const jwt = await sign(secret, 'HS256');
    const { jwk } = await keyPair();
    const ok = await clientFor(jwk, 200).auth.getClaims(jwt);
    expect(ok.error).toBeNull();
    const bad = await clientFor(jwk, 401).auth.getClaims(jwt);
    expect(bad.error).not.toBeNull();
    expect(bad.data).toBeNull();
  });
});
