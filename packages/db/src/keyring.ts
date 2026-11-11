/**
 * AES-256-GCM keyring for the AI provider keys (ADR 0011). Pure: no I/O and no env names (the name lives in pg/client.ts).
 * The only module that calls createCipheriv / createDecipheriv (r3-guard). Not exported from any barrel.
 * Every failure is a fixed message with no cause: Node's GCM errors and key bytes never leave this file.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { AiProvider } from '@stoktok/core';

export type KeyringState = 'ok' | 'absent' | 'invalid';

export const CURRENT_KEY_VERSION = 1;

export interface SealedAiKey {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

export interface AiKeyring {
  readonly state: KeyringState;
  seal(provider: AiProvider, plaintext: string): SealedAiKey;
  open(provider: AiProvider, row: SealedAiKey): string;
}

const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Canonical base64 of 32 bytes: 43 chars + one '='. */
const MASTER_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

/** Fixed format, documented in ADR 0011 and pinned by a test. Binds the provider and the key version. */
function aadFor(provider: string, keyVersion: number): Buffer {
  return Buffer.from(`stoktok:ai_keys:v1|${provider}|${keyVersion}`, 'utf8');
}

function fail(reason: string): never {
  throw new Error(`ai keyring: ${reason}`);
}

function parseMasterKey(raw: string): Buffer | undefined {
  if (!MASTER_KEY_RE.test(raw)) return undefined;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32 || key.toString('base64') !== raw) return undefined;
  if (key.every((b) => b === 0)) return undefined;
  return key;
}

/** Never throws. `undefined` and '' are absent; anything that is not a canonical 32-byte base64 key is invalid. */
export function createAiKeyring(raw: string | undefined): AiKeyring {
  if (raw === undefined || raw === '') {
    return Object.freeze({
      state: 'absent' as const,
      seal: () => fail('master key absent'),
      open: () => fail('master key absent'),
    });
  }
  const key = parseMasterKey(raw);
  if (!key) {
    return Object.freeze({
      state: 'invalid' as const,
      seal: () => fail('master key invalid'),
      open: () => fail('master key invalid'),
    });
  }
  return Object.freeze({
    state: 'ok' as const,
    seal(provider: AiProvider, plaintext: string): SealedAiKey {
      try {
        const iv = randomBytes(IV_BYTES);
        const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
        cipher.setAAD(aadFor(provider, CURRENT_KEY_VERSION));
        const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: CURRENT_KEY_VERSION };
      } catch {
        return fail('seal failed');
      }
    },
    open(provider: AiProvider, row: SealedAiKey): string {
      if (row.keyVersion !== CURRENT_KEY_VERSION) fail('unsupported key version');
      if (row.iv.length !== IV_BYTES || row.authTag.length !== TAG_BYTES) fail('malformed row');
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, row.iv, { authTagLength: TAG_BYTES });
        decipher.setAAD(aadFor(provider, row.keyVersion));
        decipher.setAuthTag(row.authTag);
        return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString('utf8');
      } catch {
        return fail('open failed');
      }
    },
  });
}
