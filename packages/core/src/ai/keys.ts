/** Same bounds and charset as the ai_key_set check in supabase/migrations/20261110000200_ai_keys.sql; keep them in sync. */
export const AI_KEY_LENGTH = { min: 20, max: 256 } as const;

export type AiKeyFormatCode = 'AI_KEY_EMPTY' | 'AI_KEY_WHITESPACE' | 'AI_KEY_LENGTH' | 'AI_KEY_CHARSET';

/** No trimming: a pasted key with a trailing newline is rejected. The result never contains the input. */
export function validateAiKeyFormat(raw: unknown): { ok: true } | { ok: false; code: AiKeyFormatCode } {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, code: 'AI_KEY_EMPTY' };
  if (/\s/.test(raw)) return { ok: false, code: 'AI_KEY_WHITESPACE' };
  if (raw.length < AI_KEY_LENGTH.min || raw.length > AI_KEY_LENGTH.max) return { ok: false, code: 'AI_KEY_LENGTH' };
  if (!/^[\x21-\x7E]+$/.test(raw)) return { ok: false, code: 'AI_KEY_CHARSET' };
  return { ok: true };
}
