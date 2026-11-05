import { isTradingDay, vnDateOf, vnMinutesOf } from '../calendar';
import { formatDate, formatTime } from '../format';
import { DEFAULT_INTRADAY_CONFIG, isInIntradayWindow } from './intraday';
import type { IntradayConfig } from './intraday';

export type RefreshPricesStatus = 'ok' | 'throttled' | 'closed' | 'failed';

/**
 * What a refresh call tells the client. `nextInMs`: when `sessionOpen`, the minimum wait before the next call; when
 * not, ms until the next session window opens today, or 0 for "do not call again".
 */
export interface RefreshPricesResult {
  status: RefreshPricesStatus;
  nextInMs: number;
  sessionOpen: boolean;
}

export type RefreshSessionState = 'open' | 'closed' | 'non_trading_day';
export type RefreshBarState = 'live' | 'delayed' | 'no_data' | 'closed' | 'non_trading_day';

/** Server-computed strings and numbers for the refresh bar; the UI only looks them up (R1). */
export interface RefreshBarView {
  state: RefreshBarState;
  sessionOpen: boolean;
  nextInMs: number;
  intervalMs: number;
  label: string;
  announcement: string;
  failedLabel: string;
  failedAnnouncement: string;
  missingText: string | null;
  note: string | null;
}

export function intradaySessionState(
  now: Date,
  holidays: readonly string[],
  config: IntradayConfig = DEFAULT_INTRADAY_CONFIG,
): RefreshSessionState {
  if (!isTradingDay(vnDateOf(now), holidays)) return 'non_trading_day';
  return isInIntradayWindow(now, holidays, config) ? 'open' : 'closed';
}

/** Ms until the next window opens today; 0 when the session is open, the day is closed or no window remains. */
export function msUntilNextSessionOpen(
  now: Date,
  holidays: readonly string[],
  config: IntradayConfig = DEFAULT_INTRADAY_CONFIG,
): number {
  if (intradaySessionState(now, holidays, config) !== 'closed') return 0;
  const m = vnMinutesOf(now);
  const next = config.sessions.find((w) => w.fromMinutesVn > m);
  if (next === undefined) return 0;
  return (next.fromMinutesVn - m) * 60_000 - (now.getTime() % 60_000);
}

/** Interim contract (before STK-050): no source call, only the session state. */
export function storedOnlyRefreshResult(
  now: Date,
  holidays: readonly string[],
  config: IntradayConfig = DEFAULT_INTRADAY_CONFIG,
): RefreshPricesResult {
  const open = intradaySessionState(now, holidays, config) === 'open';
  return {
    status: open ? 'ok' : 'closed',
    nextInMs: open ? 0 : msUntilNextSessionOpen(now, holidays, config),
    sessionOpen: open,
  };
}

export interface RefreshBarInput {
  now: Date;
  holidays: readonly string[];
  fetchedAts: readonly (string | null)[];
  config?: IntradayConfig;
}

export function buildRefreshBarView(input: RefreshBarInput): RefreshBarView {
  const { now, holidays, fetchedAts } = input;
  const config = input.config ?? DEFAULT_INTRADAY_CONFIG;
  const session = intradaySessionState(now, holidays, config);
  const result = storedOnlyRefreshResult(now, holidays, config);

  let oldestMs: number | null = null;
  let missing = 0;
  for (const f of fetchedAts) {
    const ms = f === null ? Number.NaN : Date.parse(f);
    if (Number.isNaN(ms)) missing += 1;
    else if (oldestMs === null || ms < oldestMs) oldestMs = ms;
  }

  let t: string | null = null;
  if (oldestMs !== null) {
    const oldest = new Date(oldestMs);
    t = formatTime(oldest.toISOString());
    const day = vnDateOf(oldest);
    if (day !== vnDateOf(now)) t += ` ${formatDate(day)}`;
  }

  let state: RefreshBarState;
  let label: string;
  let announcement: string;
  if (session === 'non_trading_day') {
    state = 'non_trading_day';
    label = t === null ? 'Hôm nay không giao dịch · chưa có giá' : `Hôm nay không giao dịch · cập nhật lúc ${t}`;
    announcement = 'Hôm nay không giao dịch';
  } else if (session === 'closed') {
    state = 'closed';
    label = t === null ? 'Ngoài phiên giao dịch · chưa có giá' : `Ngoài phiên giao dịch · cập nhật lúc ${t}`;
    announcement = 'Ngoài phiên giao dịch';
  } else if (oldestMs === null) {
    state = 'no_data';
    label = 'Chưa có giá';
    announcement = 'Chưa có giá';
  } else if (now.getTime() - oldestMs > config.staleAfterMs) {
    state = 'delayed';
    label = `Giá đang trễ · cập nhật lúc ${t}`;
    announcement = 'Giá đang trễ';
  } else {
    state = 'live';
    label = `Cập nhật lúc ${t}`;
    announcement = 'Giá đang được cập nhật';
  }

  return {
    state,
    sessionOpen: result.sessionOpen,
    nextInMs: result.nextInMs,
    intervalMs: config.refreshIntervalMs,
    label,
    announcement,
    failedLabel: t === null ? 'Không làm mới được' : `Không làm mới được · giá cũ lúc ${t}`,
    failedAnnouncement: 'Không làm mới được giá',
    missingText: missing > 0 && oldestMs !== null ? `${missing} mã chưa có giá` : null,
    note: result.sessionOpen ? 'Giá có thể trễ vài phút' : null,
  };
}
