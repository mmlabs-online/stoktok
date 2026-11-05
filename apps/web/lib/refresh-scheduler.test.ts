import type { RefreshPricesResult } from '@stoktok/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRefreshScheduler } from './refresh-scheduler';

const OPEN: RefreshPricesResult = { status: 'ok', nextInMs: 0, sessionOpen: true };
const INTERVAL = 30_000;

function setup(opts: {
  initial?: { sessionOpen: boolean; nextInMs: number };
  results?: (RefreshPricesResult | Error)[];
  pendingMs?: number;
} = {}) {
  let visible = true;
  let visCb: (() => void) | null = null;
  const unsubscribe = vi.fn(() => {
    visCb = null;
  });
  const queue = [...(opts.results ?? [])];
  const calls: number[] = [];
  const action = vi.fn(async () => {
    calls.push(Date.now());
    if (opts.pendingMs) await new Promise((r) => setTimeout(r, opts.pendingMs));
    const next = queue.shift() ?? OPEN;
    if (next instanceof Error) throw next;
    return next;
  });
  const afterResult = vi.fn();
  const onResult = vi.fn();
  const onBusy = vi.fn();
  const s = createRefreshScheduler({
    intervalMs: INTERVAL,
    initial: opts.initial ?? { sessionOpen: true, nextInMs: 0 },
    action,
    afterResult,
    onResult,
    onBusy,
    isVisible: () => visible,
    subscribeVisibility: (cb) => {
      visCb = cb;
      return unsubscribe;
    },
  });
  return {
    s,
    action,
    calls,
    afterResult,
    onResult,
    onBusy,
    unsubscribe,
    setVisible(v: boolean) {
      visible = v;
      visCb?.();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('refresh scheduler', () => {
  it('polls every intervalMs', async () => {
    const t = setup();
    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(t.action).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.action).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(t.action).toHaveBeenCalledTimes(2);
    expect(t.calls).toEqual([INTERVAL, 2 * INTERVAL]);
    t.s.dispose();
  });

  it('sets no timer when closed and nextInMs is 0', async () => {
    const t = setup({ initial: { sessionOpen: false, nextInMs: 0 } });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(t.action).not.toHaveBeenCalled();
    t.s.dispose();
  });

  it('wakes once at nextInMs when closed, then polls if open', async () => {
    const t = setup({ initial: { sessionOpen: false, nextInMs: 100_000 } });
    await vi.advanceTimersByTimeAsync(99_999);
    expect(t.action).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.action).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(t.action).toHaveBeenCalledTimes(2);
    t.s.dispose();
  });

  it('a tick while hidden makes no call; visible runs once, then resumes', async () => {
    const t = setup();
    t.setVisible(false);
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(t.action).not.toHaveBeenCalled();
    t.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.action).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(t.action).toHaveBeenCalledTimes(2);
    t.s.dispose();
  });

  it('a visibility change with no due tick makes no call', async () => {
    const t = setup();
    t.setVisible(false);
    t.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.action).not.toHaveBeenCalled();
    t.s.dispose();
  });

  it('never overlaps calls', async () => {
    const t = setup({ pendingMs: 90_000 });
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(t.action).toHaveBeenCalledTimes(1);
    await t.s.refreshNow();
    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(t.action).toHaveBeenCalledTimes(1);
    t.s.dispose();
  });

  it('refreshNow calls at once and restarts the interval', async () => {
    const t = setup();
    await vi.advanceTimersByTimeAsync(20_000);
    await t.s.refreshNow();
    expect(t.action).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(t.action).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.action).toHaveBeenCalledTimes(2);
    t.s.dispose();
  });

  it('afterResult runs only after a resolved action', async () => {
    const t = setup();
    await t.s.refreshNow();
    expect(t.afterResult).toHaveBeenCalledWith(OPEN);
    expect(t.onResult).toHaveBeenCalledWith('ok');
    t.s.dispose();
  });

  it('a result with nextInMs above the interval delays the next call', async () => {
    const t = setup({ results: [{ status: 'throttled', nextInMs: 50_000, sessionOpen: true }] });
    await t.s.refreshNow();
    await vi.advanceTimersByTimeAsync(49_999);
    expect(t.action).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.action).toHaveBeenCalledTimes(2);
    t.s.dispose();
  });

  it('a result with sessionOpen false stops polling, or wakes at nextInMs', async () => {
    const stop = setup({ results: [{ status: 'closed', nextInMs: 0, sessionOpen: false }] });
    await stop.s.refreshNow();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(stop.action).toHaveBeenCalledTimes(1);
    stop.s.dispose();

    const wake = setup({ results: [{ status: 'closed', nextInMs: 120_000, sessionOpen: false }] });
    await wake.s.refreshNow();
    await vi.advanceTimersByTimeAsync(119_999);
    expect(wake.action).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(wake.action).toHaveBeenCalledTimes(2);
    wake.s.dispose();
  });

  it('a rejected action reports failed, skips afterResult and keeps polling', async () => {
    const t = setup({ results: [new Error('boom')] });
    await t.s.refreshNow();
    expect(t.onResult).toHaveBeenLastCalledWith('failed');
    expect(t.afterResult).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(t.action).toHaveBeenCalledTimes(2);
    expect(t.onResult).toHaveBeenLastCalledWith('ok');
    expect(t.afterResult).toHaveBeenCalledTimes(1);
    t.s.dispose();
  });

  it('onBusy brackets the call on resolve and on reject', async () => {
    const ok = setup();
    await ok.s.refreshNow();
    expect(ok.onBusy.mock.calls).toEqual([[true], [false]]);
    ok.s.dispose();
    const bad = setup({ results: [new Error('x')] });
    await bad.s.refreshNow();
    expect(bad.onBusy.mock.calls).toEqual([[true], [false]]);
    bad.s.dispose();
  });

  it('dispose clears the timer, unsubscribes, and silences a late result', async () => {
    const t = setup({ pendingMs: 1_000 });
    const p = t.s.refreshNow();
    t.s.dispose();
    await vi.advanceTimersByTimeAsync(1_000);
    await p;
    expect(t.unsubscribe).toHaveBeenCalledTimes(1);
    expect(t.afterResult).not.toHaveBeenCalled();
    expect(t.onResult).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(t.action).toHaveBeenCalledTimes(1);
  });
});
