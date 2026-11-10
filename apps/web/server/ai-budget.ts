import 'server-only';
import type { BudgetStatus } from '@stoktok/core';

export type AiBudgetRead = { ok: true; status: BudgetStatus } | { ok: false };

/**
 * Soft-fail read for the Settings card: a missing module or a failed read becomes `{ ok: false }`
 * (logged by code only) instead of breaking the page. The dynamic import keeps the real client path.
 */
export async function readAiBudget(
  load: () => Promise<{ getAiBudgetStatus(): Promise<BudgetStatus> }> = () => import('./ai'),
): Promise<AiBudgetRead> {
  try {
    return { ok: true, status: await (await load()).getAiBudgetStatus() };
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code === 'MODULE_NOT_FOUND' ? 'module_not_found' : 'read_failed';
    console.warn(JSON.stringify({ event: 'ai_budget_read_failed', code }));
    return { ok: false };
  }
}
