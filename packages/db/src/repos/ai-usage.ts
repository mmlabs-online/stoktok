import { toSafeInt } from '@stoktok/core';
import type { AiProvider, AiTask, BudgetWindow } from '@stoktok/core';
import type { Db } from '../client';
import { DataError, mapRow, unwrap } from '../errors';
import type { AiReserveRow, AiUsageSettle } from '../rows';

export interface AiReserveRequest {
  provider: AiProvider;
  model: string;
  task: AiTask;
  reserveMicroUsd: number;
  capMicroUsd: number;
  window: BudgetWindow;
}

export interface AiReserveResult {
  usageId: number;
  granted: boolean;
  spentMicroUsd: number;
}

/** Atomic budget gate: a granted call has a `reserved` row; a refused one is logged as `refused` with cost 0. */
export async function reserveAiUsage(db: Db, req: AiReserveRequest): Promise<AiReserveResult> {
  const ctx = { table: 'ai_usage', op: 'reserve' };
  const res = await db.rpc('ai_reserve', {
    p_provider: req.provider,
    p_model: req.model,
    p_task: req.task,
    p_reserve_micro_usd: req.reserveMicroUsd,
    p_cap_micro_usd: req.capMicroUsd,
    p_from: req.window.fromTs,
    p_to: req.window.toTs,
  });
  const data = unwrap<AiReserveRow[] | AiReserveRow>(res, ctx);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new DataError('DB_ERROR', ctx.table, ctx.op, 'no data returned');
  return mapRow(
    (r: AiReserveRow) => ({
      usageId: toSafeInt(r.usage_id, 'usage_id', 'ai_usage'),
      granted: r.granted,
      spentMicroUsd: toSafeInt(r.spent_micro_usd, 'spent_micro_usd', 'ai_usage'),
    }),
    row,
    ctx,
  );
}

/**
 * Settles a reservation once: only a row still `reserved` is updated. Returns false when no row matched.
 * costMicroUsd null (unknown outcome) leaves the reservation counted at the worst case.
 */
export async function settleAiUsage(db: Db, id: number, settle: AiUsageSettle, now: Date): Promise<boolean> {
  const res = await db
    .from('ai_usage')
    .update({
      status: settle.status,
      input_tokens: settle.inputTokens,
      output_tokens: settle.outputTokens,
      cost_micro_usd: settle.costMicroUsd,
      error_code: settle.errorCode ?? null,
      settled_at: now.toISOString(),
    })
    .eq('id', id)
    .eq('status', 'reserved')
    .select('id');
  return unwrap<unknown[]>(res, { table: 'ai_usage', op: 'settle' }).length > 0;
}

export async function getAiMonthSpend(db: Db, window: BudgetWindow): Promise<number> {
  const ctx = { table: 'ai_usage', op: 'month_spend' };
  const res = await db.rpc('ai_month_spend', { p_from: window.fromTs, p_to: window.toTs });
  return mapRow((v: unknown) => toSafeInt(v, 'spent', 'ai_usage'), unwrap<unknown>(res, ctx), ctx);
}
