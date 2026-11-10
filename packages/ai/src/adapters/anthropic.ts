import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, type LlmProvider, type Part, type ProviderRequest, type ProviderResponse, type ResponsePart, type Usage } from '../types';
import { FINAL_OUTPUT_TOOL, assertNoThinking, mapThrown, outputCap, stripJsonSchemaMeta, toUsage, unwrapOutput, wrapOutputSchema } from './shared';

/** The slice of the SDK client the adapter uses; tests inject a fake. */
export interface AnthropicMessagesClient {
  messages: { create(params: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<unknown> };
}

export type AnthropicProviderOptions = { client: AnthropicMessagesClient } | { apiKey: string; timeoutMs?: number };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function toBlock(p: Part): Record<string, unknown> | null {
  if (p.type === 'text') return p.text === '' ? null : { type: 'text', text: p.text };
  if (p.type === 'tool_call') return { type: 'tool_use', id: p.id, name: p.name, input: p.input };
  return { type: 'tool_result', tool_use_id: p.id, content: p.text };
}

function usageOf(raw: unknown): Usage | null {
  if (!isObj(raw)) return null;
  const parts = [raw.input_tokens, raw.cache_creation_input_tokens ?? 0, raw.cache_read_input_tokens ?? 0];
  if (!parts.every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) return null;
  return toUsage((parts as number[]).reduce((a, b) => a + b, 0), raw.output_tokens);
}

function buildParams(req: ProviderRequest): Record<string, unknown> {
  const tools: Record<string, unknown>[] = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: stripJsonSchemaMeta(t.inputSchema) }));
  const params: Record<string, unknown> = {
    model: req.model,
    system: req.system,
    max_tokens: outputCap(req),
    thinking: { type: 'disabled' },
    messages: req.messages.map((m) => ({ role: m.role, content: m.parts.map(toBlock).filter((b) => b !== null) })),
  };
  if (req.output) {
    tools.push({ name: FINAL_OUTPUT_TOOL, description: 'Return the final answer', input_schema: wrapOutputSchema(req.output.jsonSchema).schema });
    params.tool_choice = req.tools.length === 0 ? { type: 'tool', name: FINAL_OUTPUT_TOOL } : { type: 'auto' };
  }
  if (tools.length > 0) params.tools = tools;
  return params;
}

function parseResponse(raw: unknown, req: ProviderRequest): ProviderResponse {
  if (!isObj(raw)) throw new ProviderError('malformed', null);
  const usage = usageOf(raw.usage);
  if (!usage) throw new ProviderError('malformed', null);
  const wrapped = req.output ? wrapOutputSchema(req.output.jsonSchema).wrapped : false;
  if (!Array.isArray(raw.content)) throw new ProviderError('malformed', usage);

  const parts: ResponsePart[] = [];
  let finalOutput: ResponsePart | null = null;
  for (const b of raw.content as unknown[]) {
    if (!isObj(b)) throw new ProviderError('malformed', usage);
    if (b.type === 'text' && typeof b.text === 'string') parts.push({ type: 'text', text: b.text });
    else if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
      if (b.name === FINAL_OUTPUT_TOOL) finalOutput = { type: 'json', value: unwrapOutput(b.input, wrapped) };
      else parts.push({ type: 'tool_call', id: b.id, name: b.name, input: b.input });
    } else throw new ProviderError('malformed', usage);
  }
  if (finalOutput) {
    if (parts.some((p) => p.type === 'tool_call')) throw new ProviderError('malformed', usage);
    return { parts: [finalOutput], stop: 'end', usage };
  }
  switch (raw.stop_reason) {
    case 'end_turn':
    case 'stop_sequence':
      return { parts, stop: 'end', usage };
    case 'tool_use':
      return { parts, stop: 'tool_use', usage };
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return { parts, stop: 'max_tokens', usage };
    case 'refusal':
      throw new ProviderError('refused', usage);
    default:
      throw new ProviderError('malformed', usage);
  }
}

export function createAnthropicProvider(opts: AnthropicProviderOptions): LlmProvider {
  const client: AnthropicMessagesClient =
    'client' in opts
      ? opts.client
      : (() => {
          const sdk = new Anthropic({ apiKey: opts.apiKey, maxRetries: 0, timeout: opts.timeoutMs ?? 60_000 });
          return { messages: { create: (p, o) => sdk.messages.create(p as never, o) } };
        })();

  return {
    id: 'anthropic',
    async generate(req) {
      assertNoThinking(req);
      let raw: unknown;
      try {
        raw = await client.messages.create(buildParams(req), { signal: req.signal });
      } catch (e) {
        throw mapThrown(e, req.signal);
      }
      return parseResponse(raw, req);
    },
  };
}
