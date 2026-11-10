import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  AI_CONFIG,
  AiConfigError,
  aiBudgetWindow,
  aiMessage,
  budgetStatus,
  selectProvider,
  usageCostMicroUsd,
  utf8ByteLength,
  validateAiConfig,
  worstCaseCostMicroUsd,
  type AiConfig,
  type AiProvider,
  type BudgetStatus,
} from '@stoktok/core';
import { assertReadTools, checkToolCall, toolDefs } from './tools';
import {
  ProviderError,
  type AiLog,
  type GenerateFailureReason,
  type GenerateInput,
  type GenerateResult,
  type LlmProvider,
  type Msg,
  type Part,
  type ReadTool,
  type ProviderRequest,
  type ProviderResponse,
  type ResponsePart,
  type Rng,
  type UsageLedger,
  type UsageSettle,
} from './types';
import { UNTRUSTED_DATA_RULE, newDelimiter, sanitizeForDelimiter, truncateUtf8, wrapUntrusted } from './untrusted';

type ProviderMap = Partial<Record<AiProvider, LlmProvider>>;

/** Exactly one of `providers` (fixed) or `resolveProviders` (called once per generate(), so key changes apply without a restart). */
export type AiClientOptions = (
  | { providers: ProviderMap; resolveProviders?: never }
  | { resolveProviders: () => Promise<ProviderMap>; providers?: never }
) & AiClientCommonOptions;

interface AiClientCommonOptions {
  ledger: UsageLedger;
  log: AiLog;
  cfg?: AiConfig;
  clock?: () => Date;
  rng?: Rng;
  /** Per provider call and per tool run. */
  timeoutMs?: number;
}

type ToolCall = Extract<ResponsePart, { type: 'tool_call' }>;

interface Round {
  settle: UsageSettle;
  failure?: 'provider_error' | 'invalid_output';
  calls: ToolCall[];
  value?: unknown;
  response?: ProviderResponse;
}

/**
 * select provider -> reserve worst case -> call -> settle, once per round.
 * A 22023 (or any other) error from reserve fails closed as budget_unavailable and writes no ai_usage row,
 * so such refusals appear only in logs.
 */
export class AiClient {
  private readonly providers: ProviderMap | undefined;
  private readonly resolveProviders: (() => Promise<ProviderMap>) | undefined;
  private readonly ledger: UsageLedger;
  private readonly log: AiLog;
  private readonly cfg: AiConfig;
  private readonly clock: () => Date;
  private readonly rng: Rng;
  private readonly timeoutMs: number;

  constructor(opts: AiClientOptions) {
    this.cfg = opts.cfg ?? AI_CONFIG;
    const errors = validateAiConfig(this.cfg);
    if (errors.length > 0) throw new AiConfigError(errors.join('; '));
    if (Boolean(opts.providers) === Boolean(opts.resolveProviders)) {
      throw new TypeError('AiClient needs exactly one of providers or resolveProviders');
    }
    if (opts.providers) assertProviderIds(opts.providers);
    this.providers = opts.providers;
    this.resolveProviders = opts.resolveProviders;
    this.ledger = opts.ledger;
    this.log = opts.log;
    this.clock = opts.clock ?? (() => new Date());
    this.rng = opts.rng ?? ((n) => randomBytes(n));
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async budgetStatus(): Promise<BudgetStatus> {
    return budgetStatus(await this.ledger.monthSpend(aiBudgetWindow(this.clock())), this.cfg);
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const tools = input.tools ?? [];
    assertReadTools(tools);
    if (input.messages[0]?.role !== 'user') throw new TypeError('first message must be a user turn');

    const usageIds: number[] = [];
    const fail = (reason: GenerateFailureReason): GenerateResult => ({
      ok: false,
      reason,
      messageVi:
        reason === 'budget_exhausted' || reason === 'budget_unavailable'
          ? aiMessage('budget_exhausted', { capMicroUsd: this.cfg.budget.capMicroUsd })
          : aiMessage(reason),
      usageIds,
    });

    let providers: ProviderMap;
    try {
      providers = this.resolveProviders ? await this.resolveProviders() : (this.providers as ProviderMap);
    } catch {
      // fixed event and code only: the error may carry key material
      this.log.warn({ event: 'ai_key_read_failed', code: 'key_read_failed' });
      return fail('provider_unavailable');
    }
    if (this.resolveProviders) assertProviderIds(providers);

    const enabled = (Object.keys(providers) as AiProvider[]).filter((p) => providers[p]);
    const selected = selectProvider({ task: input.task, requested: input.provider, enabled }, this.cfg);
    if (!selected.ok) return fail('provider_unavailable');
    const { provider: providerId, model } = selected;
    const provider = providers[providerId] as LlmProvider;

    const blocks = input.blocks ?? [];
    const delim = newDelimiter(this.rng, [...blocks.map((b) => b.text), input.system, ...input.messages.flatMap((m) => m.parts.map(partText))]);
    const system = `${UNTRUSTED_DATA_RULE}\n\n${input.system}`;
    const first = input.messages[0];
    let messages: Msg[] = [
      { role: 'user', parts: [...blocks.map((b): Part => ({ type: 'text', text: wrapUntrusted(b, delim) })), ...first.parts] },
      ...input.messages.slice(1),
    ];
    const jsonSchema = input.output ? z.toJSONSchema(input.output) : undefined;
    const maxRounds = this.cfg.maxToolRounds;
    let totalCost = 0;

    for (let round = 0; round <= maxRounds; round++) {
      const final = round === maxRounds;
      const defs = final ? [] : toolDefs(tools);
      const reserved = worstCaseCostMicroUsd(
        input.task,
        model,
        {
          inputUtf8Bytes: utf8ByteLength(system, JSON.stringify(defs), jsonSchema ? JSON.stringify(jsonSchema) : '', JSON.stringify(messages)),
          messageCount: messages.length,
          provider: providerId,
        },
        this.cfg,
      );

      let res;
      try {
        res = await this.ledger.reserve({
          provider: providerId,
          model,
          task: input.task,
          reserveMicroUsd: reserved,
          capMicroUsd: this.cfg.budget.capMicroUsd,
          window: aiBudgetWindow(this.clock()),
        });
      } catch (e) {
        const invalid = (e as { pgCode?: unknown } | null)?.pgCode === '22023';
        this.log.warn({ event: 'ai_reserve_failed', code: invalid ? 'reserve_invalid_args' : 'reserve_failed', reserved });
        return fail('budget_unavailable');
      }
      usageIds.push(res.usageId);
      if (!res.granted) return fail('budget_exhausted');

      const request: Omit<ProviderRequest, 'signal'> = {
        model,
        system,
        messages,
        tools: defs,
        ...(jsonSchema ? { output: { jsonSchema } } : {}),
        maxOutputTokens: this.cfg.maxOutputTokensByTask[input.task],
        thinkingBudgetTokens: this.cfg.thinkingBudgetTokensByTask[input.task],
      };
      const out = await this.callRound(provider, request, model, final, tools, input.output);

      const cost = out.settle.costMicroUsd;
      if (cost !== null && cost > reserved) {
        this.log.warn({ event: 'ai_over_reservation', usageId: res.usageId, reserved, cost });
        if (out.settle.status !== 'provider_error') out.settle.errorCode = 'over_reservation';
      }
      try {
        const saved = await this.ledger.settle(res.usageId, out.settle, this.clock());
        if (!saved) this.log.warn({ event: 'ai_settle_failed', code: 'settle_failed', usageId: res.usageId });
      } catch {
        this.log.warn({ event: 'ai_settle_failed', code: 'settle_failed', usageId: res.usageId });
      }
      totalCost += cost ?? 0;

      if (out.failure) return fail(out.failure);
      if (out.calls.length === 0) {
        return { ok: true, value: out.value, provider: providerId, model, usageIds, costMicroUsd: totalCost };
      }

      const results: Part[] = [];
      for (const [i, call] of out.calls.entries()) {
        const checked = checkToolCall(call, tools);
        if (!checked.ok) return fail('provider_error');
        let text: string;
        try {
          text = await this.runTool(checked.tool, checked.input);
        } catch {
          this.log.warn({ event: 'ai_tool_failed', code: 'tool_failed', usageId: res.usageId });
          return fail('provider_error');
        }
        const body = sanitizeForDelimiter(truncateUtf8(text, checked.tool.maxResultBytes), delim);
        results.push({
          type: 'tool_result',
          id: call.id,
          name: call.name,
          text: wrapUntrusted({ id: `r${round}c${i}`, kind: `tool:${call.name}`, text: body }, delim),
        });
      }
      messages = [
        ...messages,
        { role: 'assistant', parts: (out.response as ProviderResponse).parts.map(toPart) },
        { role: 'user', parts: results },
      ];
    }
    return fail('provider_error');
  }

  private async runTool(tool: { run(input: never, signal: AbortSignal): Promise<string> }, input: unknown): Promise<string> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      return await tool.run(input as never, ctl.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Calls the provider and classifies the round into one settle row. Never throws. */
  private async callRound(
    provider: LlmProvider,
    request: Omit<ProviderRequest, 'signal'>,
    model: string,
    final: boolean,
    tools: readonly ReadTool[],
    schema: GenerateInput['output'],
  ): Promise<Round> {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctl.abort();
        reject(new ProviderError('timeout'));
      }, this.timeoutMs);
    });
    let res: ProviderResponse;
    try {
      res = await Promise.race([provider.generate({ ...request, signal: ctl.signal }), timeout]);
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError('http');
      let inputTokens = 0;
      let outputTokens = 0;
      let costMicroUsd: number | null = null;
      if (err.usage) {
        try {
          costMicroUsd = usageCostMicroUsd(model, err.usage, this.cfg);
          inputTokens = err.usage.inputTokens;
          outputTokens = err.usage.outputTokens;
        } catch {
          // bad usage from the adapter: settle with no cost rather than throw
        }
      }
      return {
        settle: { status: 'provider_error', inputTokens, outputTokens, costMicroUsd, errorCode: err.code },
        failure: 'provider_error',
        calls: [],
      };
    } finally {
      clearTimeout(timer);
    }

    try {
      return this.classify(res, model, final, tools, schema);
    } catch {
      return {
        settle: { status: 'provider_error', inputTokens: 0, outputTokens: 0, costMicroUsd: null, errorCode: 'malformed' },
        failure: 'provider_error',
        calls: [],
      };
    }
  }

  /** May throw on a malformed provider response; callRound maps that to provider_error / malformed. */
  private classify(res: ProviderResponse, model: string, final: boolean, tools: readonly ReadTool[], schema: GenerateInput['output']): Round {
    const base = {
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      costMicroUsd: usageCostMicroUsd(model, res.usage, this.cfg),
    };
    const bad = (status: 'provider_error' | 'invalid_output', errorCode: string): Round => ({
      settle: { status, ...base, errorCode },
      failure: status,
      calls: [],
    });

    if (res.stop === 'max_tokens') return bad('invalid_output', 'truncated');
    const calls = res.parts.filter((p): p is ToolCall => p.type === 'tool_call');
    if (calls.length > 0) {
      if (final) return bad('provider_error', 'tool_rounds_exceeded');
      if (calls.length > this.cfg.maxToolCallsPerRound) return bad('provider_error', 'too_many_tool_calls');
      for (const call of calls) {
        const checked = checkToolCall(call, tools);
        if (!checked.ok) return bad('provider_error', checked.code);
      }
      return { settle: { status: 'ok', ...base }, calls, response: res };
    }

    if (!schema) {
      const text = res.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');
      return { settle: { status: 'ok', ...base }, calls: [], value: text };
    }
    let raw: unknown;
    const json = res.parts.find((p) => p.type === 'json');
    try {
      raw = json ? json.value : JSON.parse(res.parts.map((p) => (p.type === 'text' ? p.text : '')).join(''));
    } catch {
      return bad('invalid_output', 'schema_mismatch');
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return bad('invalid_output', 'schema_mismatch');
    return { settle: { status: 'ok', ...base }, calls: [], value: parsed.data };
  }
}

function assertProviderIds(providers: ProviderMap): void {
  for (const [key, provider] of Object.entries(providers)) {
    if (provider && provider.id !== key) throw new Error(`provider registered as ${key} has id ${provider.id}`);
  }
}

function partText(p: Part): string {
  return p.type === 'tool_call' ? JSON.stringify(p.input) : p.text;
}

function toPart(p: ResponsePart): Part {
  return p.type === 'json' ? { type: 'text', text: JSON.stringify(p.value) } : p;
}
