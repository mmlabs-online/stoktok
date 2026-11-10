import type { AiProvider } from '@stoktok/core';
import { createAnthropicProvider } from './adapters/anthropic';
import { createGoogleProvider } from './adapters/google';
import type { AiEnv } from './env';
import type { LlmProvider } from './types';

/** Only providers whose key is present. SDK retries are off; timeoutMs should equal the AiClient timeout. */
export function buildProviders(env: AiEnv, opts: { timeoutMs?: number } = {}): Partial<Record<AiProvider, LlmProvider>> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const out: Partial<Record<AiProvider, LlmProvider>> = {};
  if (env.anthropicApiKey) out.anthropic = createAnthropicProvider({ apiKey: env.anthropicApiKey, timeoutMs });
  if (env.googleAiApiKey) out.google = createGoogleProvider({ apiKey: env.googleAiApiKey, timeoutMs });
  return out;
}
