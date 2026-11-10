import 'server-only';
import { AiClient, makeProviderResolver, readAiEnv } from '@stoktok/ai';
import type { AiEnv } from '@stoktok/ai';
import type { AiProvider, BudgetStatus } from '@stoktok/core';
import { aiUsageLedger, getDb, readAiKeySecrets } from './db';

// The deploy env must not set the SDKs' ANTHROPIC_CUSTOM_HEADERS / GOOGLE_GENAI_API_VERSION.
const AI_TIMEOUT_MS = 60_000;

let ai: AiClient | undefined;

/** Built on first use, so importing this module needs no db and no AI keys. Callers must call requireUser() first (R6). */
export function getAi(): AiClient {
  ai ??= new AiClient({
    // UI-saved keys (Vault) win over env; read on every generate() so a changed key needs no restart.
    resolveProviders: makeProviderResolver(() => readAiKeySecrets(getDb()), () => readAiEnv(), { timeoutMs: AI_TIMEOUT_MS }),
    ledger: aiUsageLedger(getDb()),
    log: { warn: (e) => console.warn(JSON.stringify(e)) },
    timeoutMs: AI_TIMEOUT_MS,
  });
  return ai;
}

export function getAiBudgetStatus(): Promise<BudgetStatus> {
  return getAi().budgetStatus();
}

/** Booleans only: env values never leave this module. */
export function aiEnvPresence(env: AiEnv = readAiEnv()): Record<AiProvider, boolean> {
  return { anthropic: !!env.anthropicApiKey, google: !!env.googleAiApiKey };
}
