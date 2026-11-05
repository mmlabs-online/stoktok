import { describe, expect, it } from 'vitest';
import { DEFAULT_INTRADAY_CONFIG } from './intraday';
import {
  buildRefreshBarView,
  intradaySessionState,
  msUntilNextSessionOpen,
  storedOnlyRefreshResult,
} from './refresh-view';

// 2026-10-23 is a Friday; VN time is UTC+7.
const vn = (date: string, hms: string): Date => new Date(`${date}T${hms}+07:00`);
const FRI = '2026-10-23';
const cfg = DEFAULT_INTRADAY_CONFIG;

describe('intradaySessionState', () => {
  it('follows the session rule', () => {
    expect(intradaySessionState(vn(FRI, '10:00:00'), [])).toBe('open');
    expect(intradaySessionState(vn(FRI, '12:00:00'), [])).toBe('closed');
    expect(intradaySessionState(vn(FRI, '08:00:00'), [])).toBe('closed');
    expect(intradaySessionState(vn(FRI, '15:02:00'), [])).toBe('open');
    expect(intradaySessionState(vn(FRI, '15:03:00'), [])).toBe('closed');
    expect(intradaySessionState(vn('2026-10-24', '10:00:00'), [])).toBe('non_trading_day');
    expect(intradaySessionState(vn(FRI, '10:00:00'), [FRI])).toBe('non_trading_day');
  });
});

describe('msUntilNextSessionOpen', () => {
  it('counts to the next window', () => {
    expect(msUntilNextSessionOpen(vn(FRI, '08:59:30'), [])).toBe(30_000);
    expect(msUntilNextSessionOpen(vn(FRI, '08:00:00'), [])).toBe(3_600_000);
    expect(msUntilNextSessionOpen(vn(FRI, '12:00:00'), [])).toBe(3_600_000);
  });
  it('is 0 when open, after the last window, or on a closed day', () => {
    expect(msUntilNextSessionOpen(vn(FRI, '10:00:00'), [])).toBe(0);
    expect(msUntilNextSessionOpen(vn(FRI, '15:10:00'), [])).toBe(0);
    expect(msUntilNextSessionOpen(vn('2026-10-24', '08:00:00'), [])).toBe(0);
    expect(msUntilNextSessionOpen(vn(FRI, '08:00:00'), [FRI])).toBe(0);
  });
});

describe('storedOnlyRefreshResult', () => {
  it('maps the session state to the contract', () => {
    expect(storedOnlyRefreshResult(vn(FRI, '10:00:00'), [])).toEqual({ status: 'ok', nextInMs: 0, sessionOpen: true });
    expect(storedOnlyRefreshResult(vn(FRI, '12:00:00'), [])).toEqual({
      status: 'closed',
      nextInMs: 3_600_000,
      sessionOpen: false,
    });
    expect(storedOnlyRefreshResult(vn('2026-10-25', '10:00:00'), [])).toEqual({
      status: 'closed',
      nextInMs: 0,
      sessionOpen: false,
    });
  });
});

describe('buildRefreshBarView', () => {
  const now = vn(FRI, '10:15:52');
  const build = (fetchedAts: (string | null)[], at: Date = now, holidays: string[] = []) =>
    buildRefreshBarView({ now: at, holidays, fetchedAts });

  it('live', () => {
    const v = build([vn(FRI, '10:15:42').toISOString()]);
    expect(v.state).toBe('live');
    expect(v.label).toBe('Cập nhật lúc 10:15:42');
  });

  it('delayed above staleAfterMs, live at exactly staleAfterMs', () => {
    const over = new Date(now.getTime() - cfg.staleAfterMs - 1).toISOString();
    const exact = new Date(now.getTime() - cfg.staleAfterMs).toISOString();
    const d = build([over]);
    expect(d.state).toBe('delayed');
    expect(d.label).toMatch(/^Giá đang trễ · cập nhật lúc \d{2}:\d{2}:\d{2}$/);
    expect(build([exact]).state).toBe('live');
  });

  it('the oldest row wins', () => {
    const v = build([vn(FRI, '10:15:42').toISOString(), vn(FRI, '10:10:52').toISOString()]);
    expect(v.state).toBe('delayed');
    expect(v.label).toBe('Giá đang trễ · cập nhật lúc 10:10:52');
  });

  it('reports missing rows and no data', () => {
    const iso = vn(FRI, '10:15:42').toISOString();
    expect(build([iso, null, null]).missingText).toBe('2 mã chưa có giá');
    expect(build([iso]).missingText).toBeNull();
    for (const empty of [[null, null], []]) {
      const v = build(empty);
      expect(v.state).toBe('no_data');
      expect(v.label).toBe('Chưa có giá');
      expect(v.missingText).toBeNull();
    }
  });

  it('closed', () => {
    const at = vn(FRI, '20:00:00');
    const v = build([vn(FRI, '15:30:12').toISOString()], at);
    expect(v.state).toBe('closed');
    expect(v.label).toBe('Ngoài phiên giao dịch · cập nhật lúc 15:30:12');
    expect(build([], at).label).toBe('Ngoài phiên giao dịch · chưa có giá');
  });

  it('non trading day adds the date when not today', () => {
    const at = vn('2026-10-24', '10:00:00');
    const v = build([vn(FRI, '15:30:12').toISOString()], at);
    expect(v.state).toBe('non_trading_day');
    expect(v.label).toBe('Hôm nay không giao dịch · cập nhật lúc 15:30:12 23/10/2026');
    expect(build([], at).label).toBe('Hôm nay không giao dịch · chưa có giá');
  });

  it('a future fetchedAt counts as live', () => {
    expect(build([new Date(now.getTime() + 60_000).toISOString()]).state).toBe('live');
  });

  it('failed labels', () => {
    expect(build([vn(FRI, '10:15:42').toISOString()]).failedLabel).toBe('Không làm mới được · giá cũ lúc 10:15:42');
    expect(build([]).failedLabel).toBe('Không làm mới được');
  });

  it('announcements are distinct per state and carry no digits', () => {
    const iso = vn(FRI, '10:15:42').toISOString();
    const views = [
      build([iso]),
      build([new Date(now.getTime() - 200_000).toISOString()]),
      build([]),
      build([iso], vn(FRI, '20:00:00')),
      build([iso], vn('2026-10-24', '10:00:00')),
    ];
    const texts = [...views.map((v) => v.announcement), views[0]!.failedAnnouncement];
    expect(new Set(texts).size).toBe(6);
    for (const t of texts) expect(t).not.toMatch(/\d/);
  });

  it('note, interval and session fields come from config and the contract', () => {
    const open = build([]);
    expect(open.note).toBe('Giá có thể trễ vài phút');
    expect(open.intervalMs).toBe(DEFAULT_INTRADAY_CONFIG.refreshIntervalMs);
    const r = storedOnlyRefreshResult(now, []);
    expect(open.sessionOpen).toBe(r.sessionOpen);
    expect(open.nextInMs).toBe(r.nextInMs);
    expect(build([], vn(FRI, '20:00:00')).note).toBeNull();
  });
});
