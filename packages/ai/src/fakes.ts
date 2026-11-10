import { fitsBudget, type AiProvider, type BudgetWindow } from '@stoktok/core';
import type { LlmProvider, ProviderRequest, ProviderResponse, ReserveRequest, ReserveResult, UsageLedger, UsageSettle } from './types';

type Step = ProviderResponse | Error | ((req: ProviderRequest) => ProviderResponse | Promise<ProviderResponse>);

/** Scripted provider: each call consumes the next step (response, error to throw, or function of the request). */
export class FakeProvider implements LlmProvider {
  readonly calls: ProviderRequest[] = [];
  constructor(
    readonly id: AiProvider,
    private readonly script: Step[],
  ) {}

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(req);
    const step = this.script.shift();
    if (step === undefined) throw new Error('FakeProvider script exhausted');
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? step(req) : step;
  }
}

/** In-memory ledger using the same gate as ai_reserve. `throwOnReserve(n)` returns an error to throw on the n-th reserve (1-based). */
export class FakeLedger implements UsageLedger {
  readonly reserves: ReserveRequest[] = [];
  readonly settles: { usageId: number; settle: UsageSettle }[] = [];
  readonly windows: BudgetWindow[] = [];
  /** Order of ledger calls: 'reserve' | 'settle'. */
  readonly events: string[] = [];
  settleResult = true;
  throwOnReserve: (n: number) => unknown = () => undefined;
  private readonly open = new Map<number, number>();
  private settled = 0;

  constructor(
    private readonly capMicroUsd: number,
    spentMicroUsd = 0,
  ) {
    this.settled = spentMicroUsd;
  }

  get spent(): number {
    let total = this.settled;
    for (const v of this.open.values()) total += v;
    return total;
  }

  async reserve(r: ReserveRequest): Promise<ReserveResult> {
    this.reserves.push(r);
    this.events.push('reserve');
    const err = this.throwOnReserve(this.reserves.length);
    if (err !== undefined) throw err;
    const usageId = this.reserves.length;
    const granted = fitsBudget(this.spent, r.reserveMicroUsd, this.capMicroUsd);
    if (granted) this.open.set(usageId, r.reserveMicroUsd);
    return { usageId, granted, spentMicroUsd: this.spent };
  }

  async settle(usageId: number, s: UsageSettle): Promise<boolean> {
    this.events.push('settle');
    this.settles.push({ usageId, settle: s });
    const reserved = this.open.get(usageId) ?? 0;
    this.open.delete(usageId);
    this.settled += s.costMicroUsd ?? reserved;
    return this.settleResult;
  }

  async monthSpend(window: BudgetWindow): Promise<number> {
    this.windows.push(window);
    return this.spent;
  }
}

/** Deterministic rng: yields bytes start, start+1, ... (mod 256) across calls. */
export function seqRng(start = 0): (bytes: number) => Uint8Array {
  let next = start;
  return (n) => Uint8Array.from({ length: n }, () => next++ % 256);
}
