import type { AiProvider } from '@stoktok/core';
import { buildProviders } from './providers';
import type { AiEnv } from './env';
import type { LlmProvider } from './types';

export type StoredAiKeys = Partial<Record<AiProvider, string>>;
export type AiKeySource = 'ui' | 'env' | 'none';

const present = (v: string | undefined): string | undefined => (v && v.trim() ? v : undefined);

/** Per provider: a stored (UI) key wins, else the env key, else absent. Env variable names stay in env.ts. */
export function resolveAiKeys(stored: StoredAiKeys, env: AiEnv): { keys: AiEnv; source: Record<AiProvider, AiKeySource> } {
  const keys: AiEnv = {};
  const source: Record<AiProvider, AiKeySource> = { anthropic: 'none', google: 'none' };
  const anthropic = present(stored.anthropic);
  const google = present(stored.google);
  if (anthropic) {
    keys.anthropicApiKey = anthropic;
    source.anthropic = 'ui';
  } else if (env.anthropicApiKey) {
    keys.anthropicApiKey = env.anthropicApiKey;
    source.anthropic = 'env';
  }
  if (google) {
    keys.googleAiApiKey = google;
    source.google = 'ui';
  } else if (env.googleAiApiKey) {
    keys.googleAiApiKey = env.googleAiApiKey;
    source.google = 'env';
  }
  return { keys, source };
}

/**
 * Reads both sources on every call (no cache), so a key saved or deleted in one process is used by the next call in the others.
 * A readStored rejection propagates: the caller fails closed instead of silently falling back to env.
 */
export function makeProviderResolver(
  readStored: () => Promise<StoredAiKeys>,
  readEnv: () => AiEnv,
  opts: { timeoutMs: number },
): () => Promise<Partial<Record<AiProvider, LlmProvider>>> {
  return async () => {
    const stored = await readStored();
    return buildProviders(resolveAiKeys(stored, readEnv()).keys, { timeoutMs: opts.timeoutMs });
  };
}
