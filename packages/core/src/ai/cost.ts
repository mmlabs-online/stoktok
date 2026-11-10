import { ceilDiv, toSafe } from '../money';
import { AI_CONFIG, type AiConfig, type AiTask } from './config';

export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiConfigError';
  }
}

const MTOK = 1_000_000n;

function assertCount(n: number, field: string): bigint {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${field} must be a non-negative safe integer`);
  return BigInt(n);
}

/** ceil((in x inPrice + out x outPrice) / 1,000,000) micro-USD, rounded once. Thinking tokens count as output. */
export function usageCostMicroUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number },
  cfg: AiConfig = AI_CONFIG,
): number {
  const price = cfg.priceTable[model];
  if (!price) throw new AiConfigError(`no price row for model ${model}`);
  const numer =
    assertCount(usage.inputTokens, 'inputTokens') * BigInt(price.inMicroUsdPerMTok) +
    assertCount(usage.outputTokens, 'outputTokens') * BigInt(price.outMicroUsdPerMTok);
  return toSafe(ceilDiv(numer, MTOK));
}

/** UTF-8 byte length (core has no TextEncoder in its type libs). */
export function utf8ByteLength(...texts: readonly string[]): number {
  let bytes = 0;
  for (const text of texts) {
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 0;
      bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    }
  }
  return bytes;
}

/**
 * Upper bound reserved before a call. Input tokens <= UTF-8 bytes (a byte-level tokenizer cannot emit more tokens
 * than bytes) plus per-message overhead; output = max output + thinking budget for the task.
 */
export function worstCaseCostMicroUsd(
  task: AiTask,
  model: string,
  input: { inputUtf8Bytes: number; messageCount: number },
  cfg: AiConfig = AI_CONFIG,
): number {
  const inputTokens = assertCount(input.inputUtf8Bytes, 'inputUtf8Bytes') + assertCount(input.messageCount, 'messageCount') * BigInt(cfg.perMessageOverheadTokens);
  const outputTokens = cfg.maxOutputTokensByTask[task] + cfg.thinkingBudgetTokensByTask[task];
  return usageCostMicroUsd(model, { inputTokens: toSafe(inputTokens), outputTokens }, cfg);
}
