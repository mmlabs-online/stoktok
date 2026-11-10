import { ProviderError, type ProviderRequest, type Usage } from '../types';

/** Reserved name of the synthetic structured-output tool. */
export const FINAL_OUTPUT_TOOL = 'final_output';

/** Valid safe non-negative integers only; anything else is null (never zeros). */
export function toUsage(input: unknown, output: unknown): Usage | null {
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (!ok(input) || !ok(output)) return null;
  return { inputTokens: input, outputTokens: output };
}

/** Provider-side output cap: matches the reserve assumption in core cost.ts. */
export const outputCap = (req: ProviderRequest): number => req.maxOutputTokens + req.thinkingBudgetTokens;

/** Part cannot carry thinking blocks or thought signatures yet, so thinking > 0 fails closed. */
export function assertNoThinking(req: ProviderRequest): void {
  if (req.thinkingBudgetTokens !== 0) throw new ProviderError('malformed', null, 'thinking_unsupported');
}

export function wrapOutputSchema(schema: unknown): { schema: unknown; wrapped: boolean } {
  const s = schema as { type?: unknown } | null;
  if (s && typeof s === 'object' && s.type === 'object') return { schema, wrapped: false };
  return { schema: { type: 'object', properties: { value: schema }, required: ['value'], additionalProperties: false }, wrapped: true };
}

export function unwrapOutput(input: unknown, wrapped: boolean): unknown {
  if (!wrapped) return input;
  return input && typeof input === 'object' ? (input as { value?: unknown }).value : undefined;
}

export function stripJsonSchemaMeta(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const rest = { ...(schema as Record<string, unknown>) };
  delete rest.$schema;
  return rest;
}

/** Duck-typed so fakes can throw plain objects. The result never carries usage. */
export function mapThrown(e: unknown, signal?: AbortSignal): ProviderError {
  if (e instanceof ProviderError) return e;
  const o = e && typeof e === 'object' ? (e as { status?: unknown; name?: unknown }) : {};
  const name = typeof o.name === 'string' ? o.name : '';
  if (name === 'AbortError' || signal?.aborted || name.includes('Timeout')) return new ProviderError('timeout', null);
  if (o.status === 429 || o.status === 529) return new ProviderError('rate_limited', null);
  return new ProviderError('http', null);
}
