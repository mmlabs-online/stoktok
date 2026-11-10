import type { ZodType } from 'zod';
import type { AiProvider, AiTask, BudgetWindow } from '@stoktok/core';

export type Part =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; text: string };

export interface Msg {
  role: 'user' | 'assistant';
  parts: Part[];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface ProviderRequest {
  model: string;
  system: string;
  messages: Msg[];
  /** Empty on the final allowed round. */
  tools: ToolDef[];
  /** Present when the caller wants structured JSON. */
  output?: { jsonSchema: unknown };
  maxOutputTokens: number;
  thinkingBudgetTokens: number;
  signal: AbortSignal;
}

export type ResponsePart =
  | { type: 'text'; text: string }
  | { type: 'json'; value: unknown }
  | { type: 'tool_call'; id: string; name: string; input: unknown };

export interface ProviderResponse {
  parts: ResponsePart[];
  stop: 'end' | 'tool_use' | 'max_tokens';
  usage: Usage;
}

export type ProviderErrorCode = 'timeout' | 'rate_limited' | 'http' | 'refused' | 'malformed';

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly usage: Usage | null = null,
    message: string = code,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface LlmProvider {
  readonly id: AiProvider;
  generate(req: ProviderRequest): Promise<ProviderResponse>;
}

export interface UsageSettle {
  status: 'ok' | 'provider_error' | 'invalid_output';
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number | null;
  errorCode?: string;
}

export interface ReserveRequest {
  provider: AiProvider;
  model: string;
  task: AiTask;
  reserveMicroUsd: number;
  capMicroUsd: number;
  window: BudgetWindow;
}

export interface ReserveResult {
  usageId: number;
  granted: boolean;
  spentMicroUsd: number;
}

/** Structurally matches reserveAiUsage / settleAiUsage / getAiMonthSpend in @stoktok/db (bound in STK-070). */
export interface UsageLedger {
  reserve(r: ReserveRequest): Promise<ReserveResult>;
  settle(usageId: number, s: UsageSettle, now: Date): Promise<boolean>;
  monthSpend(window: BudgetWindow): Promise<number>;
}

export interface ReadTool<I = unknown> {
  kind: 'read';
  name: string;
  description: string;
  input: ZodType<I>;
  maxResultBytes: number;
  run(input: I, signal: AbortSignal): Promise<string>;
}

export interface UntrustedBlock {
  id: string;
  kind: string;
  text: string;
}

/** Logs carry only event, codes, IDs and integers: never prompt, data or output text (R9). */
export interface AiLog {
  warn(e: { event: string; code?: string; usageId?: number; reserved?: number; cost?: number | null }): void;
}

export interface GenerateInput {
  task: AiTask;
  provider?: AiProvider;
  system: string;
  /** First message must be role 'user'. */
  messages: Msg[];
  blocks?: UntrustedBlock[];
  tools?: ReadTool[];
  output?: ZodType;
}

export type GenerateFailureReason =
  | 'budget_exhausted'
  | 'budget_unavailable'
  | 'provider_unavailable'
  | 'provider_error'
  | 'invalid_output';

export type GenerateResult =
  | { ok: true; value: unknown; provider: AiProvider; model: string; usageIds: number[]; costMicroUsd: number }
  | { ok: false; reason: GenerateFailureReason; messageVi: string; usageIds: number[] };

export type Rng = (bytes: number) => Uint8Array;
