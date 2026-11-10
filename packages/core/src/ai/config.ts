import { VN_TIME_ZONE } from '../format';

export type AiProvider = 'anthropic' | 'google';
export type AiTask = 'chat' | 'summary' | 'explanation';

export const AI_PROVIDERS: readonly AiProvider[] = ['anthropic', 'google'];
export const AI_TASKS: readonly AiTask[] = ['chat', 'summary', 'explanation'];

/** Integer micro-USD per 1,000,000 tokens. */
export interface PriceRow {
  inMicroUsdPerMTok: number;
  outMicroUsdPerMTok: number;
}

export interface AiConfig {
  modelsByTask: Record<AiProvider, Record<AiTask, string>>;
  defaultProviderByTask: Record<AiTask, AiProvider>;
  priceTable: Record<string, PriceRow>;
  maxOutputTokensByTask: Record<AiTask, number>;
  thinkingBudgetTokensByTask: Record<AiTask, number>;
  perMessageOverheadTokens: number;
  maxToolRounds: number;
  /** Most tool calls one provider response may contain. */
  maxToolCallsPerRound: number;
  /** Fixed input tokens per call that the provider adds beyond our payload (tool/system framing). */
  providerOverheadTokens: Record<AiProvider, number>;
  budget: { capMicroUsd: number; warnPpm: number; timeZone: string };
}

/**
 * R5: models, prices and the budget are configuration.
 * Model IDs and prices are defaults to verify before go-live (prices as of 2026-11; check provider pricing pages).
 */
export const AI_CONFIG: AiConfig = {
  modelsByTask: {
    anthropic: { chat: 'claude-sonnet-4-5', summary: 'claude-haiku-4-5', explanation: 'claude-haiku-4-5' },
    google: { chat: 'gemini-2.5-flash', summary: 'gemini-2.5-flash', explanation: 'gemini-2.5-flash' },
  },
  defaultProviderByTask: { chat: 'anthropic', summary: 'google', explanation: 'google' },
  priceTable: {
    'claude-sonnet-4-5': { inMicroUsdPerMTok: 3_000_000, outMicroUsdPerMTok: 15_000_000 },
    'claude-haiku-4-5': { inMicroUsdPerMTok: 1_000_000, outMicroUsdPerMTok: 5_000_000 },
    'gemini-2.5-flash': { inMicroUsdPerMTok: 300_000, outMicroUsdPerMTok: 2_500_000 },
  },
  maxOutputTokensByTask: { chat: 2000, summary: 1500, explanation: 1000 },
  thinkingBudgetTokensByTask: { chat: 0, summary: 0, explanation: 0 },
  perMessageOverheadTokens: 16,
  maxToolRounds: 4,
  maxToolCallsPerRound: 8,
  // Default to verify before go-live; measure real overhead in STK-070.
  providerOverheadTokens: { anthropic: 1000, google: 1000 },
  budget: { capMicroUsd: 5_000_000, warnPpm: 800_000, timeZone: VN_TIME_ZONE },
};

const isPosInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;
const isNonNegInt = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/** Returns a list of problems; empty means valid. Fails closed: every configured model needs a price row. */
export function validateAiConfig(cfg: AiConfig): string[] {
  const errors: string[] = [];
  for (const provider of AI_PROVIDERS) {
    for (const task of AI_TASKS) {
      const model = cfg.modelsByTask[provider]?.[task];
      if (!model) errors.push(`no model for ${provider}/${task}`);
      else if (!cfg.priceTable[model]) errors.push(`model ${model} has no price row`);
    }
  }
  for (const [model, row] of Object.entries(cfg.priceTable)) {
    if (!isPosInt(row.inMicroUsdPerMTok) || !isPosInt(row.outMicroUsdPerMTok)) {
      errors.push(`price of ${model} must be positive integers`);
    }
  }
  for (const task of AI_TASKS) {
    if (!isPosInt(cfg.maxOutputTokensByTask[task])) errors.push(`maxOutputTokens for ${task} must be a positive integer`);
    if (!isNonNegInt(cfg.thinkingBudgetTokensByTask[task])) errors.push(`thinkingBudgetTokens for ${task} must be a non-negative integer`);
  }
  if (!isNonNegInt(cfg.perMessageOverheadTokens)) errors.push('perMessageOverheadTokens must be a non-negative integer');
  if (!isPosInt(cfg.maxToolRounds)) errors.push('maxToolRounds must be a positive integer');
  if (!isPosInt(cfg.maxToolCallsPerRound)) errors.push('maxToolCallsPerRound must be a positive integer');
  for (const provider of AI_PROVIDERS) {
    if (!isNonNegInt(cfg.providerOverheadTokens?.[provider])) errors.push(`providerOverheadTokens for ${provider} must be a non-negative integer`);
  }
  const { capMicroUsd, warnPpm, timeZone } = cfg.budget;
  if (!isPosInt(capMicroUsd)) errors.push('budget cap must be a positive integer');
  if (!Number.isSafeInteger(warnPpm) || warnPpm < 1 || warnPpm > 999_999) errors.push('budget warnPpm must be an integer in 1..999999');
  if (timeZone !== VN_TIME_ZONE) errors.push(`budget timeZone must be ${VN_TIME_ZONE}`);
  return errors;
}
