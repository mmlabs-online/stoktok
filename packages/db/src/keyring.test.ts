import { createDecipheriv, randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, test } from 'vitest';
import { createAiKeyring, type SealedAiKey } from './keyring';

const KEY_BYTES = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');
const MASTER = KEY_BYTES.toString('base64');
const OTHER = Buffer.from('fedcba9876543210fedcba9876543210', 'utf8').toString('base64');
const PLAIN = 'DUMMY-SENTINEL-google-key-5678';

function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected throw');
}

describe('master key parsing', () => {
  test('a canonical 32-byte base64 key is ok', () => {
    expect(createAiKeyring(MASTER).state).toBe('ok');
    expect(createAiKeyring(randomBytes(32).toString('base64')).state).toBe('ok');
  });

  test('undefined and empty string are absent', () => {
    expect(createAiKeyring(undefined).state).toBe('absent');
    expect(createAiKeyring('').state).toBe('absent');
  });

  test('invalid: wrong length, base64url, whitespace, missing padding, non-canonical, all zero, not base64', () => {
    const base = randomBytes(32).toString('base64');
    // The last base64 char of 32 bytes carries 2 spare bits: change it to a char with non-zero spare bits.
    const nonCanonical = `${MASTER.slice(0, 42)}${MASTER[42] === 'B' ? 'C' : 'B'}=`;
    const urlSafe = `${'-_'.repeat(21)}-=`;
    for (const bad of [
      randomBytes(24).toString('base64'),
      randomBytes(48).toString('base64'),
      urlSafe,
      `${base}\n`,
      `${base} `,
      base.slice(0, -1),
      nonCanonical,
      Buffer.alloc(32).toString('base64'),
      'not-base64',
    ]) {
      expect(createAiKeyring(bad).state, bad).toBe('invalid');
    }
  });
});

describe('seal and open', () => {
  const ring = createAiKeyring(MASTER);

  test('round trip for both providers; GCM layout matches the database checks', () => {
    for (const provider of ['anthropic', 'google'] as const) {
      const s = ring.seal(provider, PLAIN);
      expect(s.keyVersion).toBe(1);
      expect(s.iv.length).toBe(12);
      expect(s.authTag.length).toBe(16);
      expect(s.ciphertext.length).toBe(Buffer.byteLength(PLAIN));
      expect(ring.open(provider, s)).toBe(PLAIN);
    }
  });

  test('two seals of the same plaintext differ in iv and ciphertext', () => {
    const a = ring.seal('google', PLAIN);
    const b = ring.seal('google', PLAIN);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  test('open with the other provider throws (AAD binds the provider)', () => {
    expect(() => ring.open('anthropic', ring.seal('google', PLAIN))).toThrow('ai keyring');
  });

  test('keyVersion 2 throws; a v1 row whose keyVersion was changed throws', () => {
    const s = ring.seal('google', PLAIN);
    expect(() => ring.open('google', { ...s, keyVersion: 2 })).toThrow('ai keyring');
    expect(() => ring.open('google', { ...s, keyVersion: 0 })).toThrow('ai keyring');
  });

  test('a flipped byte in ciphertext, iv or authTag throws; a different master key throws; wrong lengths throw', () => {
    const s = ring.seal('google', PLAIN);
    const flip = (b: Buffer) => {
      const c = Buffer.from(b);
      c[0] = c[0]! ^ 1;
      return c;
    };
    expect(() => ring.open('google', { ...s, ciphertext: flip(s.ciphertext) })).toThrow('ai keyring');
    expect(() => ring.open('google', { ...s, iv: flip(s.iv) })).toThrow('ai keyring');
    expect(() => ring.open('google', { ...s, authTag: flip(s.authTag) })).toThrow('ai keyring');
    expect(() => ring.open('google', { ...s, iv: s.iv.subarray(0, 11) })).toThrow('ai keyring');
    expect(() => ring.open('google', { ...s, authTag: s.authTag.subarray(0, 15) })).toThrow('ai keyring');
    expect(() => createAiKeyring(OTHER).open('google', s)).toThrow('ai keyring');
  });

  test("the AAD format is pinned: raw node:crypto decrypt with AAD 'stoktok:ai_keys:v1|google|1' succeeds", () => {
    const s = ring.seal('google', PLAIN);
    const d = createDecipheriv('aes-256-gcm', KEY_BYTES, s.iv, { authTagLength: 16 });
    d.setAAD(Buffer.from('stoktok:ai_keys:v1|google|1', 'utf8'));
    d.setAuthTag(s.authTag);
    expect(Buffer.concat([d.update(s.ciphertext), d.final()]).toString('utf8')).toBe(PLAIN);
  });

  test('seal and open on an absent or invalid keyring throw a fixed error', () => {
    const sealed: SealedAiKey = ring.seal('google', PLAIN);
    for (const r of [createAiKeyring(undefined), createAiKeyring('nope')]) {
      expect(thrown(() => r.seal('google', PLAIN)).message).toMatch(/^ai keyring: master key (absent|invalid)$/);
      expect(thrown(() => r.open('google', sealed)).message).toMatch(/^ai keyring: master key (absent|invalid)$/);
    }
  });
});

describe('no leaks', () => {
  const ring = createAiKeyring(MASTER);

  test('errors carry neither the master key nor the plaintext and have no cause', () => {
    const s = ring.seal('google', PLAIN);
    const errs = [
      thrown(() => ring.open('anthropic', s)),
      thrown(() => ring.open('google', { ...s, keyVersion: 9 })),
      thrown(() => createAiKeyring(OTHER).open('google', s)),
      thrown(() => createAiKeyring(MASTER.slice(1)).seal('google', PLAIN)),
    ];
    for (const e of errs) {
      const text = `${e.message}${String(e)}${JSON.stringify(e)}`;
      for (const secret of [MASTER, KEY_BYTES.toString('hex'), PLAIN, 'SENTINEL']) expect(text).not.toContain(secret);
      expect(e.cause).toBeUndefined();
    }
  });

  test('the keyring object is frozen and shows neither the master key nor its hex', () => {
    expect(Object.isFrozen(ring)).toBe(true);
    const shown = `${JSON.stringify(ring)}${inspect(ring, { showHidden: true, depth: Infinity })}`;
    expect(shown).not.toContain(MASTER);
    expect(shown).not.toContain(KEY_BYTES.toString('hex'));
    expect(Object.keys(ring)).toEqual(['state', 'seal', 'open']);
  });
});
