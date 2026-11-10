import { describe, expect, test } from 'vitest';
import { validateAiKeyFormat } from './keys';

const SENTINEL = 'DUMMY-not-a-real-key-';
const key = (n: number) => (SENTINEL + 'x'.repeat(n)).slice(0, n);

describe('validateAiKeyFormat', () => {
  test('accepts a 20-char and a 256-char printable-ASCII key', () => {
    expect(validateAiKeyFormat(key(20))).toEqual({ ok: true });
    expect(validateAiKeyFormat(key(256))).toEqual({ ok: true });
  });

  test('rejects empty, undefined and non-string as AI_KEY_EMPTY', () => {
    for (const v of ['', undefined, null, 42, {}]) expect(validateAiKeyFormat(v)).toEqual({ ok: false, code: 'AI_KEY_EMPTY' });
  });

  test('rejects any whitespace as AI_KEY_WHITESPACE without trimming', () => {
    const k = key(24);
    for (const v of [` ${k}`, `${k} `, `${k.slice(0, 10)} ${k.slice(10)}`, `${k}\n`, `${k}\r\n`, `${k}\t`]) {
      expect(validateAiKeyFormat(v)).toEqual({ ok: false, code: 'AI_KEY_WHITESPACE' });
    }
  });

  test('rejects 19 and 257 chars as AI_KEY_LENGTH', () => {
    expect(validateAiKeyFormat(key(19))).toEqual({ ok: false, code: 'AI_KEY_LENGTH' });
    expect(validateAiKeyFormat(key(257))).toEqual({ ok: false, code: 'AI_KEY_LENGTH' });
  });

  test('rejects non-ASCII as AI_KEY_CHARSET', () => {
    expect(validateAiKeyFormat(key(24) + 'ã')).toEqual({ ok: false, code: 'AI_KEY_CHARSET' });
    expect(validateAiKeyFormat(key(24) + '​')).toEqual({ ok: false, code: 'AI_KEY_CHARSET' });
  });

  test('the result never contains the input', () => {
    for (const v of [SENTINEL + ' with space', SENTINEL + 'ã'.repeat(30), SENTINEL]) {
      expect(JSON.stringify(validateAiKeyFormat(v))).not.toContain(SENTINEL);
    }
  });
});
