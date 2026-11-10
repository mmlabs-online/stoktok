import { GoogleGenAI } from '@google/genai';
import { ProviderError, type LlmProvider, type Part, type ProviderRequest, type ProviderResponse, type ResponsePart, type Usage } from '../types';
import { FINAL_OUTPUT_TOOL, assertNoThinking, mapThrown, outputCap, stripJsonSchemaMeta, toUsage, unwrapOutput, wrapOutputSchema } from './shared';

/** The slice of the SDK client the adapter uses; tests inject a fake. */
export interface GoogleModelsClient {
  models: { generateContent(params: Record<string, unknown>): Promise<unknown> };
}

export type GoogleProviderOptions = { client: GoogleModelsClient } | { apiKey: string; timeoutMs?: number };

const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com';
const SYNTHETIC_ID = 'gsyn_';
const REFUSED = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const withId = (id: string): { id?: string } => (id.startsWith(SYNTHETIC_ID) ? {} : { id });

function toPart(p: Part): Record<string, unknown> | null {
  if (p.type === 'text') return p.text === '' ? null : { text: p.text };
  if (p.type === 'tool_call') return { functionCall: { name: p.name, args: p.input, ...withId(p.id) } };
  return { functionResponse: { name: p.name, response: { result: p.text }, ...withId(p.id) } };
}

function usageOf(raw: unknown, hasOutput: boolean): Usage | null {
  if (!isObj(raw)) return null;
  const prompt = raw.promptTokenCount;
  const toolUse = raw.toolUsePromptTokenCount ?? 0;
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (!ok(prompt) || !ok(toolUse)) return null;
  // Output tokens = max(candidates + thoughts, total - prompt - toolUse) whenever a valid total exists, so a low or
  // missing candidate count never under-settles. Output present with no candidate count and no usable total is malformed.
  const missing = raw.candidatesTokenCount == null;
  const counted = [missing ? 0 : raw.candidatesTokenCount, raw.thoughtsTokenCount ?? 0];
  if (!counted.every(ok)) return null;
  const derived = ok(raw.totalTokenCount) ? raw.totalTokenCount - prompt - toolUse : NaN;
  if (missing && hasOutput && !ok(derived)) return null;
  const base = (counted as number[]).reduce((a, b) => a + b, 0);
  return toUsage(prompt + toolUse, ok(derived) ? Math.max(base, derived) : base);
}

function buildParams(req: ProviderRequest): Record<string, unknown> {
  const config: Record<string, unknown> = {
    systemInstruction: req.system,
    maxOutputTokens: outputCap(req),
    thinkingConfig: { thinkingBudget: req.thinkingBudgetTokens, includeThoughts: false },
    abortSignal: req.signal,
  };
  const declarations: Record<string, unknown>[] = req.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: stripJsonSchemaMeta(t.inputSchema),
  }));
  if (req.output) {
    if (req.tools.length === 0) {
      config.responseMimeType = 'application/json';
      config.responseJsonSchema = stripJsonSchemaMeta(req.output.jsonSchema);
    } else {
      declarations.push({ name: FINAL_OUTPUT_TOOL, description: 'Return the final answer', parametersJsonSchema: wrapOutputSchema(req.output.jsonSchema).schema });
    }
  }
  if (declarations.length > 0) config.tools = [{ functionDeclarations: declarations }];
  return {
    model: req.model,
    contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: m.parts.map(toPart).filter((p) => p !== null) })),
    config,
  };
}

function parseResponse(raw: unknown, req: ProviderRequest): ProviderResponse {
  if (!isObj(raw)) throw new ProviderError('malformed', null);
  const candidate = Array.isArray(raw.candidates) ? (raw.candidates as unknown[])[0] : undefined;
  const cparts = isObj(candidate) && isObj(candidate.content) ? candidate.content.parts : undefined;
  const usage = usageOf(raw.usageMetadata, Array.isArray(cparts) && cparts.length > 0);
  if (!usage) throw new ProviderError('malformed', null);
  if (!isObj(candidate)) {
    const blocked = isObj(raw.promptFeedback) && raw.promptFeedback.blockReason;
    throw new ProviderError(blocked ? 'refused' : 'malformed', usage);
  }
  const wrapped = req.output ? wrapOutputSchema(req.output.jsonSchema).wrapped : false;
  const round = req.messages.filter((m) => m.role === 'assistant').length;
  const content = isObj(candidate.content) ? candidate.content : {};
  const rawParts: unknown[] = Array.isArray(content.parts) ? content.parts : [];

  const parts: ResponsePart[] = [];
  let finalOutput: ResponsePart | null = null;
  let calls = 0;
  for (const p of rawParts) {
    if (!isObj(p)) throw new ProviderError('malformed', usage);
    if (p.thought === true) continue;
    if (typeof p.text === 'string') parts.push({ type: 'text', text: p.text });
    else if (isObj(p.functionCall) && typeof p.functionCall.name === 'string') {
      const fc = p.functionCall;
      if (fc.name === FINAL_OUTPUT_TOOL) finalOutput = { type: 'json', value: unwrapOutput(fc.args, wrapped) };
      else parts.push({ type: 'tool_call', id: typeof fc.id === 'string' ? fc.id : `${SYNTHETIC_ID}${round}_${calls}`, name: fc.name as string, input: fc.args });
      calls += 1;
    } else throw new ProviderError('malformed', usage);
  }
  const reason = candidate.finishReason;
  if (typeof reason === 'string' && REFUSED.has(reason)) throw new ProviderError('refused', usage);
  if (reason !== 'STOP' && reason !== 'MAX_TOKENS') throw new ProviderError('malformed', usage);
  if (finalOutput) {
    if (calls > 1) throw new ProviderError('malformed', usage);
    // A truncated final_output is partial JSON: never hand it back.
    return reason === 'MAX_TOKENS' ? { parts: [], stop: 'max_tokens', usage } : { parts: [finalOutput], stop: 'end', usage };
  }
  if (reason === 'MAX_TOKENS') return { parts, stop: 'max_tokens', usage };
  return { parts, stop: calls > 0 ? 'tool_use' : 'end', usage };
}

export function createGoogleProvider(opts: GoogleProviderOptions): LlmProvider {
  const client: GoogleModelsClient =
    'client' in opts
      ? opts.client
      : (() => {
          const sdk = new GoogleGenAI({ apiKey: opts.apiKey, vertexai: false, httpOptions: { baseUrl: GOOGLE_BASE_URL, timeout: opts.timeoutMs ?? 60_000, retryOptions: { attempts: 1 } } });
          return { models: { generateContent: (p) => sdk.models.generateContent(p as never) } };
        })();

  return {
    id: 'google',
    async generate(req) {
      assertNoThinking(req);
      let raw: unknown;
      try {
        raw = await client.models.generateContent(buildParams(req));
      } catch (e) {
        throw mapThrown(e, req.signal);
      }
      return parseResponse(raw, req);
    },
  };
}
