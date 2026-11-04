import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HolidayCalendarCard } from './holiday-calendar-card';

const render = (o: Partial<React.ComponentProps<typeof HolidayCalendarCard>> = {}) =>
  renderToStaticMarkup(<HolidayCalendarCard savedHolidays={[]} initialHolidays="" currentYear={2026} {...o} />);

describe('HolidayCalendarCard', () => {
  it('title, note and summary', () => {
    const out = render();
    expect(out).toContain('Lịch nghỉ giao dịch');
    expect(out).toContain('Ba sàn nghỉ cùng ngày');
    expect(out).toMatch(/Tổng (<!-- -->)?38(<!-- -->)? ngày: (<!-- -->)?13(<!-- -->)? tạm tính, (<!-- -->)?0(<!-- -->)? do bạn thêm/);
  });

  it('year groups newest first; only the current year is open', () => {
    const out = render();
    const i27 = out.indexOf('Năm 2027');
    const i26 = out.indexOf('Năm 2026');
    const i25 = out.indexOf('Năm 2025');
    expect(i27).toBeGreaterThan(-1);
    expect(i27).toBeLessThan(i26);
    expect(i26).toBeLessThan(i25);
    expect(out.match(/<details open/g)).toHaveLength(1);
    expect(out).toMatch(/<details open=""><summary[^>]*>Năm 2026/);
  });

  it('chips and provisional text', () => {
    const out = render({ savedHolidays: ['2026-10-20'], initialHolidays: '2026-10-20' });
    for (const t of ['Có sẵn', 'Tạm tính', 'chưa có thông báo của sàn', 'Bạn thêm']) expect(out).toContain(t);
  });

  it('only user rows have Xóa; seeded rows show the lock text', () => {
    const out = render({ savedHolidays: ['2026-10-20'], initialHolidays: '2026-10-20' });
    expect(out.match(/>Xóa</g)).toHaveLength(1);
    expect(out).toContain('aria-label="Xóa ngày 20/10/2026"');
    expect(out).toMatch(/<button type="button"[^>]*aria-label="Xóa ngày 20\/10\/2026"/);
    expect(out).toContain('Ngày có sẵn trong ứng dụng, không xóa được tại đây');
  });

  it('hidden input holds user dates only', () => {
    const out = render({ savedHolidays: ['2026-10-20'], initialHolidays: '2026-11-24,2026-10-20' });
    expect(out).toContain('name="holidays"');
    expect(out).toMatch(/<input type="hidden" name="holidays" value="2026-11-24,2026-10-20"/);
  });

  it('server error renders as an alert', () => {
    const out = render({ error: { code: 'HOLIDAY_WEEKEND', message: 'Lỗi thử' } });
    expect(out).toMatch(/id="holidays-error" role="alert"[^>]*>Lỗi thử/);
  });

  it('no nested form; add is a button; date input is not submitted', () => {
    const out = render();
    expect(out).not.toContain('<form');
    expect(out).toMatch(/<button type="button"[^>]*>Thêm</);
    expect(out).toMatch(/<input id="holidayNew" type="date"/);
    expect(out).not.toMatch(/<input id="holidayNew"[^>]*name=/);
  });

  it('invalid stored value is listed with Không hợp lệ and Xóa', () => {
    const out = render({ initialHolidays: 'bad' });
    expect(out).toContain('Không hợp lệ');
    expect(out).toContain('aria-label="Xóa giá trị bad"');
  });
});
