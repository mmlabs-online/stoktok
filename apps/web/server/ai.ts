import 'server-only';
import { AiClient, buildProviders, readAiEnv } from '@stoktok/ai';
import type { BudgetStatus } from '@stoktok/core';
import { aiUsageLedger, getDb } from './db';

// The deploy env must not set the SDKs' ANTHROPIC_CUSTOM_HEADERS / GOOGLE_GENAI_API_VERSION.
const AI_TIMEOUT_MS = 60_000;

let ai: AiClient | undefined;

/** Built on first use, so importing this module needs no db and no AI keys. Callers must call requireUser() first (R6). */
export function getAi(): AiClient {
  ai ??= new AiClient({
    providers: buildProviders(readAiEnv(), { timeoutMs: AI_TIMEOUT_MS }),
    ledger: aiUsageLedger(getDb()),
    log: { warn: (e) => console.warn(JSON.stringify(e)) },
    timeoutMs: AI_TIMEOUT_MS,
  });
  return ai;
}

export function getAiBudgetStatus(): Promise<BudgetStatus> {
  return getAi().budgetStatus();
}
