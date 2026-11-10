import { aiMessage, formatUsdMicro } from '@stoktok/core';
import type { AiBudgetMeter } from '@stoktok/core';
import { AlertTriangle, Ban, CheckCircle2 } from 'lucide-react';
import type { AiBudgetRead } from '../../server/ai-budget';

const cardClass = 'bg-surface border-border space-y-4 rounded-lg border p-4';

const FILL = { ok: 'bg-accent', warn: 'bg-warn', exhausted: 'bg-price-down' } as const;

/** Read-only AI spend card. Every number comes from core (budgetStatus, aiBudgetMeter, formatUsdMicro, aiMessage). */
export function AiUsageCard({ read, meter }: { read: AiBudgetRead; meter: AiBudgetMeter | null }) {
  return (
    <section className={`${cardClass} max-w-2xl`} aria-labelledby="ai-usage-title">
      <div>
        <h2 id="ai-usage-title" className="text-base font-semibold">
          Chi phí AI tháng này
        </h2>
        <p className="text-fg-muted text-sm">Chỉ đọc — hạn mức tính theo tháng (giờ Việt Nam)</p>
      </div>
      {read.ok && meter ? <Body status={read.status} meter={meter} /> : <ErrorLine />}
    </section>
  );
}

function ErrorLine() {
  return (
    <p role="status" className="text-warn flex items-center gap-2 text-sm">
      <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
      Không tải được chi phí AI tháng này. Thử tải lại trang.
    </p>
  );
}

function Body({ status, meter }: { status: Extract<AiBudgetRead, { ok: true }>['status']; meter: AiBudgetMeter }) {
  const spent = formatUsdMicro(status.spentMicroUsd);
  const cap = formatUsdMicro(status.capMicroUsd);
  return (
    <>
      <p className="num text-lg font-semibold">
        {spent} / {cap} <span className="text-fg-muted text-sm font-normal">{status.percent}%</span>
      </p>
      <div
        role="meter"
        aria-labelledby="ai-usage-title"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meter.fillPercent}
        aria-valuetext={`Đã dùng ${spent} / ${cap} (${status.percent}%)`}
        className="bg-border relative h-2 w-full overflow-hidden rounded-full"
      >
        <div className={`${FILL[status.level]} h-full`} style={{ width: `${meter.fillPercent}%` }} />
        <div aria-hidden="true" className="bg-fg absolute top-0 h-full w-0.5" style={{ left: `${meter.warnPercent}%` }} />
      </div>
      <p className="text-fg-muted flex justify-between text-sm">
        <span>
          Còn lại <span className="num">{formatUsdMicro(status.remainingMicroUsd)}</span>
        </span>
        <span>Tháng {meter.monthLabel} (đặt lại ngày 1)</span>
      </p>
      <Level status={status} />
    </>
  );
}

function Level({ status }: { status: Extract<AiBudgetRead, { ok: true }>['status'] }) {
  const { level } = status;
  if (level === 'warn') {
    return (
      <p role="status" data-level="warn" className="text-warn flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
        {aiMessage('budget_warn', { percent: status.percent, spentMicroUsd: status.spentMicroUsd, capMicroUsd: status.capMicroUsd })}
      </p>
    );
  }
  if (level === 'exhausted') {
    return (
      <p role="status" data-level="exhausted" className="text-price-down bg-price-down-bg flex items-center gap-2 rounded px-2 py-1 text-sm font-semibold">
        <Ban aria-hidden="true" className="size-4 shrink-0" />
        {aiMessage('budget_exhausted', { capMicroUsd: status.capMicroUsd })}
      </p>
    );
  }
  return (
    <p role="status" data-level="ok" className="text-fg-muted flex items-center gap-2 text-sm">
      <CheckCircle2 aria-hidden="true" className="text-accent size-4 shrink-0" />
      Trong hạn mức
    </p>
  );
}
