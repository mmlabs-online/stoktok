import { AiClient, buildProviders, readAiEnv } from '@stoktok/ai';
import { aiUsageLedger, createServiceClient } from '@stoktok/db';
import type { Db } from '@stoktok/db';

// The deploy env must not set the SDKs' ANTHROPIC_CUSTOM_HEADERS / GOOGLE_GENAI_API_VERSION.
const AI_TIMEOUT_MS = 60_000;

/** Builds the AI client from the given env (default process.env). No job uses it yet. */
export function createWorkerAi(opts: { env?: Record<string, string | undefined>; db?: Db } = {}): AiClient {
  const env = opts.env ?? process.env;
  return new AiClient({
    providers: buildProviders(readAiEnv(env), { timeoutMs: AI_TIMEOUT_MS }),
    ledger: aiUsageLedger(opts.db ?? createServiceClient(env)),
    log: { warn: (e) => console.warn(JSON.stringify(e)) },
    timeoutMs: AI_TIMEOUT_MS,
  });
}
