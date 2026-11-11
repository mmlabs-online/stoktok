import { toSafeInt } from '@stoktok/core';
import type { AiProvider, AiTask, BudgetWindow } from '@stoktok/core';
import { sql } from 'kysely';
import { DataError, mapRow } from '../errors';
import { q } from '../pg/access';
import type { PgDb } from '../pg/client';
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

/**
 * Atomic budget gate: a granted call has a `reserved` row; a refused one is logged as `refused` with cost 0.
 * Never run inside a transaction: ai_reserve takes its own advisory lock and must not wait on a caller's transaction.
 */
export async function reserveAiUsage(db: PgDb, req: AiReserveRequest): Promise<AiReserveResult> {
  const ctx = { table: 'ai_usage', op: 'reserve' };
  const rows = await q(db, ctx, async (k) =>
    (
      await sql<AiReserveRow>`select usage_id, granted, spent_micro_usd from public.ai_reserve(${req.provider}::text, ${req.model}::text, ${req.task}::text, ${req.reserveMicroUsd}::bigint, ${req.capMicroUsd}::bigint, ${req.window.fromTs}::timestamptz, ${req.window.toTs}::timestamptz)`.execute(k)
    ).rows,
  );
  const row = rows[0];
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
export async function settleAiUsage(db: PgDb, id: number, settle: AiUsageSettle, now: Date): Promise<boolean> {
  const settledAt = now.toISOString();
  const rows = await q(db, { table: 'ai_usage', op: 'settle' }, (k) =>
    k
      .updateTable('ai_usage')
      .set({
        status: settle.status,
        input_tokens: settle.inputTokens,
        output_tokens: settle.outputTokens,
        cost_micro_usd: settle.costMicroUsd,
        error_code: settle.errorCode ?? null,
        settled_at: settledAt,
      })
      .where('id', '=', String(id))
      .where('status', '=', 'reserved')
      .returning('id')
      .execute(),
  );
  return rows.length > 0;
}

export async function getAiMonthSpend(db: PgDb, window: BudgetWindow): Promise<number> {
  const ctx = { table: 'ai_usage', op: 'month_spend' };
  const rows = await q(db, ctx, async (k) =>
    (await sql<{ spent: unknown }>`select public.ai_month_spend(${window.fromTs}::timestamptz, ${window.toTs}::timestamptz) as spent`.execute(k)).rows,
  );
  const row = rows[0];
  if (!row) throw new DataError('DB_ERROR', ctx.table, ctx.op, 'no data returned');
  return mapRow((v: unknown) => toSafeInt(v, 'spent', 'ai_usage'), row.spent, ctx);
}

/** Binds the ledger functions to `db`. Structurally the `UsageLedger` port of @stoktok/ai; errors pass through unchanged (pgCode survives). */
export function aiUsageLedger(db: PgDb) {
  return {
    reserve: (r: AiReserveRequest) => reserveAiUsage(db, r),
    settle: (id: number, s: AiUsageSettle, now: Date) => settleAiUsage(db, id, s, now),
    monthSpend: (w: BudgetWindow) => getAiMonthSpend(db, w),
  };
}
