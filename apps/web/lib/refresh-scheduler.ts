import type { RefreshPricesResult, RefreshPricesStatus } from '@stoktok/core';

/** DOM-free polling loop for the price refresh bar. All timing decisions come from core (R1, R5). */
export interface RefreshSchedulerDeps {
  intervalMs: number;
  initial: { sessionOpen: boolean; nextInMs: number };
  action: () => Promise<RefreshPricesResult>;
  /** Called only after an action resolved (the client re-renders server data here). */
  afterResult: (r: RefreshPricesResult) => void;
  onResult: (status: RefreshPricesStatus) => void;
  onBusy: (busy: boolean) => void;
  isVisible: () => boolean;
  /** Returns an unsubscribe function. */
  subscribeVisibility: (cb: () => void) => () => void;
  timers?: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (id: unknown) => void;
  };
}

export interface RefreshScheduler {
  refreshNow(): Promise<void>;
  /** Re-plan from fresh server data. Ignored while failures are being retried or after retries stopped. */
  replan(r: { sessionOpen: boolean; nextInMs: number }): void;
  dispose(): void;
}

/** Consecutive failures after which polling stops until the user presses refresh. */
const MAX_FAILURES = 3;

export function createRefreshScheduler(deps: RefreshSchedulerDeps): RefreshScheduler {
  const setTimer = deps.timers?.set ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer = deps.timers?.clear ?? ((id: unknown): void => clearTimeout(id as ReturnType<typeof setTimeout>));

  let timer: unknown = null;
  let inFlight = false;
  let due = false;
  let disposed = false;
  let sessionOpen = deps.initial.sessionOpen;
  let failures = 0;

  const clear = (): void => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const plan = (r: { sessionOpen: boolean; nextInMs: number }): void => {
    clear();
    sessionOpen = r.sessionOpen;
    let wait: number | null = null;
    if (r.sessionOpen) wait = Math.max(deps.intervalMs, r.nextInMs);
    else if (r.nextInMs > 0) wait = r.nextInMs;
    if (wait !== null) timer = setTimer(tick, wait);
  };

  const run = async (): Promise<void> => {
    inFlight = true;
    due = false;
    clear();
    deps.onBusy(true);
    try {
      const r = await deps.action();
      if (disposed) return;
      failures = 0;
      deps.afterResult(r);
      deps.onResult(r.status);
      plan(r);
    } catch {
      if (disposed) return;
      failures += 1;
      deps.onResult('failed');
      clear();
      // Backoff: interval, 2x interval, ... then stop (no timer) until refreshNow.
      if (sessionOpen && failures < MAX_FAILURES) {
        timer = setTimer(tick, deps.intervalMs * 2 ** (failures - 1));
      }
    } finally {
      inFlight = false;
      deps.onBusy(false);
    }
  };

  function tick(): void {
    timer = null;
    if (disposed) return;
    if (!deps.isVisible()) {
      due = true;
      return;
    }
    if (inFlight) return;
    void run();
  }

  const unsubscribe = deps.subscribeVisibility(() => {
    if (disposed || !due || !deps.isVisible() || inFlight) return;
    void run();
  });

  plan(deps.initial);

  return {
    refreshNow: async () => {
      if (disposed || inFlight) return;
      failures = 0;
      await run();
    },
    replan: (r) => {
      if (disposed || failures > 0) return;
      plan(r);
    },
    dispose: () => {
      disposed = true;
      clear();
      unsubscribe();
    },
  };
}
