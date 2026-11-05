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
  dispose(): void;
}

export function createRefreshScheduler(deps: RefreshSchedulerDeps): RefreshScheduler {
  const setTimer = deps.timers?.set ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer = deps.timers?.clear ?? ((id: unknown): void => clearTimeout(id as ReturnType<typeof setTimeout>));

  let timer: unknown = null;
  let inFlight = false;
  let due = false;
  let disposed = false;
  let sessionOpen = deps.initial.sessionOpen;

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
      deps.afterResult(r);
      deps.onResult(r.status);
      plan(r);
    } catch {
      if (disposed) return;
      deps.onResult('failed');
      plan({ sessionOpen, nextInMs: 0 });
    } finally {
      inFlight = false;
      if (!disposed) deps.onBusy(false);
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
      await run();
    },
    dispose: () => {
      disposed = true;
      clear();
      unsubscribe();
    },
  };
}
