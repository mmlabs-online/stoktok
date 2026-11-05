'use client';

import type { RefreshBarView, RefreshPricesResult } from '@stoktok/core';
import { AlertTriangle, CalendarX, Clock, RefreshCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useRef, useState, useTransition } from 'react';
import { createRefreshScheduler } from '../lib/refresh-scheduler';
import type { RefreshScheduler } from '../lib/refresh-scheduler';

type BarKey = RefreshBarView['state'] | 'failed';

const ICONS: Partial<Record<BarKey, { Icon: LucideIcon; className: string }>> = {
  delayed: { Icon: AlertTriangle, className: 'text-warn font-semibold' },
  failed: { Icon: AlertTriangle, className: 'text-warn font-semibold' },
  closed: { Icon: Clock, className: 'text-fg-muted' },
  non_trading_day: { Icon: CalendarX, className: 'text-fg-muted' },
};

export function RefreshBarContent({
  view,
  failed,
  busy,
  onRefresh,
}: {
  view: RefreshBarView;
  failed: boolean;
  busy: boolean;
  onRefresh: () => void;
}) {
  const key: BarKey = failed ? 'failed' : view.state;
  const icon = ICONS[key];
  return (
    <div aria-busy={busy} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <div className="space-y-0.5">
        <p className={`flex items-center gap-1.5 ${icon ? icon.className : 'text-fg-muted'}`}>
          {icon && <icon.Icon aria-hidden className="size-4 shrink-0" />}
          <span>{failed ? view.failedLabel : view.label}</span>
        </p>
        {view.missingText && <p className="text-fg-muted text-xs">{view.missingText}</p>}
        {view.note && <p className="text-fg-muted text-xs">{view.note}</p>}
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {failed ? view.failedAnnouncement : view.announcement}
        </p>
      </div>
      <button
        type="button"
        aria-disabled={busy}
        aria-busy={busy}
        onClick={busy ? undefined : onRefresh}
        className="border-border inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border px-3"
      >
        <RefreshCw aria-hidden className={`size-4 shrink-0 ${busy ? 'motion-safe:animate-spin' : ''}`} />
        Làm mới
      </button>
    </div>
  );
}

export function PriceRefreshBar({ view, action }: { view: RefreshBarView; action: () => Promise<RefreshPricesResult> }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  const schedulerRef = useRef<RefreshScheduler | null>(null);

  // Effect events keep a new server-action reference after router.refresh() from restarting the timer.
  const runAction = useEffectEvent(() => action());
  const rerender = useEffectEvent(() => startTransition(() => router.refresh()));

  const initial = useEffectEvent(() => ({
    intervalMs: view.intervalMs,
    plan: { sessionOpen: view.sessionOpen, nextInMs: view.nextInMs },
  }));

  // One scheduler per mounted bar: view changes only re-plan, so an in-flight call is never overlapped.
  useEffect(() => {
    const { intervalMs, plan } = initial();
    const scheduler = createRefreshScheduler({
      intervalMs,
      initial: plan,
      action: () => runAction(),
      afterResult: () => rerender(),
      onResult: (status) => setFailed(status === 'failed'),
      onBusy: setBusy,
      isVisible: () => document.visibilityState === 'visible',
      subscribeVisibility: (cb) => {
        document.addEventListener('visibilitychange', cb);
        return () => document.removeEventListener('visibilitychange', cb);
      },
    });
    schedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, []);

  useEffect(() => {
    schedulerRef.current?.replan({ sessionOpen: view.sessionOpen, nextInMs: view.nextInMs });
  }, [view.sessionOpen, view.nextInMs]);

  return (
    <RefreshBarContent
      view={view}
      failed={failed}
      busy={busy || isPending}
      onRefresh={() => void schedulerRef.current?.refreshNow()}
    />
  );
}
