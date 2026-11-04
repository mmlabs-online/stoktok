'use client';

import { addUserHoliday, entryMessage, formatDate, holidayCalendarView, isValidDate, removeUserHoliday, splitHolidayList } from '@stoktok/core';
import type { HolidayRow } from '@stoktok/core';
import { useState } from 'react';
import type { FormMessage } from '../../server/transactions/handlers';
import { inputClass } from '../transactions/form-fields';

const chipClass = 'border-border text-fg-muted inline-flex items-center rounded border px-2 py-0.5 text-xs';
const removeClass = 'border-border inline-flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm';

function Chip({ row }: { row: HolidayRow }) {
  if (row.status === 'user') return <span className={chipClass}>Bạn thêm</span>;
  if (row.status === 'provisional') {
    return (
      <span className={`${chipClass} border-dashed`}>
        <span aria-hidden="true">⚠ </span>Tạm tính
      </span>
    );
  }
  return <span className={chipClass}>Có sẵn</span>;
}

/**
 * Edits the user-owned part of the holiday calendar. The list travels in a hidden `holidays` input
 * of the surrounding settings form; all validation and grouping come from core.
 */
export function HolidayCalendarCard({
  savedHolidays,
  initialHolidays,
  currentYear,
  error,
}: {
  savedHolidays: string[];
  initialHolidays: string;
  currentYear: number;
  error?: FormMessage;
}) {
  const [current, setCurrent] = useState(() => splitHolidayList(initialHolidays));
  const [draft, setDraft] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const view = holidayCalendarView(savedHolidays, current);
  const remove = (date: string) => setCurrent((c) => removeUserHoliday(c, date));
  const add = () => {
    const r = addUserHoliday(current, draft);
    if (!r.ok) return setAddError(entryMessage(r.error.code, r.error.params));
    setCurrent(r.dates);
    setDraft('');
    setAddError(null);
  };
  return (
    <section className="bg-surface border-border space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="font-semibold">Lịch nghỉ giao dịch</h2>
        <p className="text-fg-muted text-xs">Ba sàn nghỉ cùng ngày. Xác minh với thông báo của HOSE/HNX.</p>
      </div>
      <p className="text-sm">
        Tổng {view.summary.total} ngày: {view.summary.provisional} tạm tính, {view.summary.user} do bạn thêm
      </p>

      {view.invalid.length > 0 && (
        <ul aria-label="Giá trị không hợp lệ" className="space-y-1">
          {view.invalid.map((v) => (
            <li key={v} className="flex items-center justify-between gap-2 text-sm">
              <span>{v}</span>
              <span className={chipClass}>Không hợp lệ</span>
              <button type="button" onClick={() => remove(v)} aria-label={`Xóa giá trị ${v}`} className={removeClass}>
                Xóa
              </button>
            </li>
          ))}
        </ul>
      )}

      {view.years.map((y) => (
        <details key={y.year} open={y.year === currentYear}>
          <summary className="min-h-11 cursor-pointer text-sm font-medium">
            Năm {y.year} ({y.rows.length} ngày)
          </summary>
          <ul aria-label={`Ngày nghỉ năm ${y.year}`} className="divide-border divide-y">
            {y.rows.map((r) => (
              <li key={r.date} className="space-y-1 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{r.dateLabel}</span>
                  <span className="text-fg-muted">{r.weekdayLabel}</span>
                  <span>{r.name ?? '—'}</span>
                  <Chip row={r} />
                  {r.pending && <span className="text-fg-muted text-xs">chưa lưu</span>}
                  {r.removable && (
                    <button type="button" onClick={() => remove(r.date)} aria-label={`Xóa ngày ${r.dateLabel}`} className={removeClass}>
                      Xóa
                    </button>
                  )}
                </div>
                {r.status === 'provisional' && <p className="text-fg-muted text-xs">chưa có thông báo của sàn</p>}
                {!r.removable && <p className="text-fg-muted text-xs">Ngày có sẵn trong ứng dụng, không xóa được tại đây</p>}
                {r.source && (
                  <details>
                    <summary className="text-fg-muted cursor-pointer text-xs">Nguồn</summary>
                    <p className="text-fg-muted text-xs break-words">{r.source}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </details>
      ))}

      <div className="space-y-1">
        <label htmlFor="holidayNew" className="block text-sm font-medium">
          Thêm ngày nghỉ
        </label>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            id="holidayNew"
            type="date"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-invalid={addError ? true : undefined}
            aria-describedby={addError ? 'holidayNew-help holidayNew-error' : 'holidayNew-help'}
            className={inputClass}
          />
          <button type="button" onClick={add} className={removeClass}>
            Thêm
          </button>
        </div>
        <p id="holidayNew-help" className="text-fg-muted text-xs">
          Sau khi lưu, các khoảng trống dữ liệu giá nằm hoàn toàn trong ngày nghỉ sẽ được đánh dấu là ngày không giao dịch ở lần đồng bộ cuối ngày tiếp theo.
        </p>
        {addError && (
          <p id="holidayNew-error" role="alert" className="text-price-down text-sm">
            {addError}
          </p>
        )}
      </div>

      {view.removed.length > 0 && (
        <p role="status" className="text-fg-muted text-xs">
          Sẽ xóa {view.removed.length} ngày khi lưu: {view.removed.map((d) => (isValidDate(d) ? formatDate(d) : d)).join(', ')}.
          Các khoảng trống dữ liệu đã được đánh dấu theo những ngày này không tự mở lại (xem apps/worker/README.md, mục Holidays).
        </p>
      )}
      {error && (
        <p id="holidays-error" role="alert" className="text-price-down text-sm">
          {error.message}
        </p>
      )}
      <input type="hidden" name="holidays" value={current.join(',')} />
    </section>
  );
}
