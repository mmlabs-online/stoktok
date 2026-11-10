import { vnDateOf } from '../calendar';
import { formatDate } from '../format';
import { AI_PROVIDERS } from './config';
import type { AiProvider } from './config';
import { AI_KEY_LENGTH } from './keys';
import type { AiKeyFormatCode } from './keys';

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = { anthropic: 'Anthropic', google: 'Google AI' };

export type AiKeyRowState = 'ui' | 'env' | 'none';

export interface AiKeyRow {
  provider: AiProvider;
  label: string;
  state: AiKeyRowState;
  last4?: string;
  /** DD/MM/YYYY, Vietnam date. */
  savedOn?: string;
  /** A server env key exists for this provider. */
  envFallback: boolean;
}

export type AiKeyErrorCode = AiKeyFormatCode | 'AI_KEY_PROVIDER' | 'AI_KEY_DB_ERROR';

export type AiKeyActionState =
  | { ok: true; provider: AiProvider; last4: string; savedAt: string }
  | { ok: true; provider: AiProvider; deleted: boolean }
  | { ok: false; provider: AiProvider | null; code: AiKeyErrorCode };

/** Precedence (ADR 0009 §3): UI key, then env key, then none. Meta rows for unknown providers are ignored. */
export function aiKeyRows(
  meta: readonly { provider: string; last4: string; updatedAt: string }[],
  envPresent: Record<AiProvider, boolean>,
): AiKeyRow[] {
  return AI_PROVIDERS.map((provider) => {
    const m = meta.find((r) => r.provider === provider);
    const base = { provider, label: AI_PROVIDER_LABELS[provider], envFallback: envPresent[provider] };
    if (m) return { ...base, state: 'ui' as const, last4: m.last4, savedOn: formatDate(vnDateOf(new Date(m.updatedAt))) };
    return { ...base, state: envPresent[provider] ? ('env' as const) : ('none' as const) };
  });
}

/** Fixed strings: never interpolate the input. */
export function aiKeyMessage(code: AiKeyErrorCode, op: 'save' | 'delete'): string {
  switch (code) {
    case 'AI_KEY_EMPTY':
      return 'Hãy dán khóa API.';
    case 'AI_KEY_WHITESPACE':
      return 'Khóa có khoảng trắng hoặc xuống dòng. Hãy dán lại đúng khóa.';
    case 'AI_KEY_LENGTH':
      return `Khóa phải dài từ ${AI_KEY_LENGTH.min} đến ${AI_KEY_LENGTH.max} ký tự.`;
    case 'AI_KEY_CHARSET':
      return 'Khóa chứa ký tự không hợp lệ. Hãy dán lại đúng khóa.';
    case 'AI_KEY_PROVIDER':
      return 'Nhà cung cấp không hợp lệ.';
    case 'AI_KEY_DB_ERROR':
      return op === 'save' ? 'Không lưu được khóa. Thử lại.' : 'Không xóa được khóa. Thử lại.';
  }
}

export function aiKeySuccessMessage(provider: AiProvider, op: 'save' | 'delete'): string {
  return `${op === 'save' ? 'Đã lưu' : 'Đã xóa'} khóa ${AI_PROVIDER_LABELS[provider]}`;
}
