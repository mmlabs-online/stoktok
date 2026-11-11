import { AiClient, makeProviderResolver, readAiEnv } from '@stoktok/ai';
import { aiUsageLedger, readAiKeySecrets } from '@stoktok/db';
import type { Db } from '@stoktok/db';

// The deploy env must not set the SDKs' ANTHROPIC_CUSTOM_HEADERS / GOOGLE_GENAI_API_VERSION.
const AI_TIMEOUT_MS = 60_000;

/** Builds the AI client from the given env (default process.env) and db handle. No job uses it yet. */
export function createWorkerAi(opts: { env?: Record<string, string | undefined>; db: Db }): AiClient {
  const env = opts.env ?? process.env;
  const { db } = opts;
  return new AiClient({
    // UI-saved keys (Vault) win over env; read on every generate() so a changed key needs no restart.
    resolveProviders: makeProviderResolver(() => readAiKeySecrets(db), () => readAiEnv(env), { timeoutMs: AI_TIMEOUT_MS }),
    ledger: aiUsageLedger(db),
    log: { warn: (e) => console.warn(JSON.stringify(e)) },
    timeoutMs: AI_TIMEOUT_MS,
  });
}
