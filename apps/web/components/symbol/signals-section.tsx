import type { InputVM, SignalRowVM, SignalsSectionVM } from '@stoktok/core';
import { AlertTriangle, EyeOff, Info } from 'lucide-react';
import { DisclaimerNote } from '../disclaimer-note';
import { EmptyState } from '../empty-state';

const HELPER_TEXT =
  'Tín hiệu mô tả chiều hướng theo quy tắc cố định, không phải đề xuất giao dịch. Giờ cập nhật theo giờ Việt Nam.';

export function SignalsSection({ vm }: { vm: SignalsSectionVM }) {
  return (
    <section aria-labelledby="signals-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="signals-heading" className="text-lg font-semibold">
          Tín hiệu trung hạn
        </h2>
        {vm.kind === 'list' && <p className="text-fg-muted text-sm">{vm.summaryText}</p>}
      </div>
      <DisclaimerNote className="text-sm" />
      <p className="text-fg-muted text-sm">{HELPER_TEXT}</p>
      <Body vm={vm} />
    </section>
  );
}

function Body({ vm }: { vm: SignalsSectionVM }) {
  if (vm.kind === 'empty') return <EmptyState title="Chưa có tín hiệu cho mã này" />;
  if (vm.kind === 'hidden') {
    return (
      <div className="border-warn text-warn space-y-2 rounded-lg border p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold">
          <AlertTriangle aria-hidden className="size-4 shrink-0" />
          Tín hiệu tạm ẩn do dữ liệu chưa cập nhật
        </p>
        <p>Tín hiệu gần nhất: {vm.lastSignalDateText}</p>
        <ul className="list-disc space-y-1 pl-5">
          {vm.causes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {vm.rows.map((row) => (
        <li key={row.ruleId} className="bg-surface border-border space-y-2 rounded-lg border p-4">
          <Row row={row} />
        </li>
      ))}
    </ul>
  );
}

function Row({ row }: { row: SignalRowVM }) {
  if (row.state === 'no_signal') {
    return (
      <>
        <h3 className="font-semibold">{row.ruleName}</h3>
        <p className="text-fg-muted text-sm">{row.text}</p>
      </>
    );
  }
  if (row.state === 'hidden') {
    return (
      <>
        <h3 className="font-semibold">{row.ruleName}</h3>
        <p className="text-fg-muted flex items-center gap-2 text-sm">
          <EyeOff aria-hidden className="size-4 shrink-0" />
          Tạm ẩn — dữ liệu chưa cập nhật
        </p>
        <ul className="text-fg-muted list-disc space-y-1 pl-5 text-sm">
          {row.causes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="text-fg-muted text-sm">Tín hiệu gần nhất: {row.lastSignalDateText}</p>
      </>
    );
  }
  if (row.state === 'suppressed') {
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{row.ruleName}</h3>
          <span className="text-fg-muted border-border inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
            <EyeOff aria-hidden className="size-3" />
            Tạm ẩn
          </span>
        </div>
        <ul className="space-y-1 text-sm">
          {row.reasons.map((r) => (
            <li key={r.text} className="flex items-start gap-2">
              {r.kind === 'data' ? (
                <AlertTriangle aria-hidden className="text-warn mt-0.5 size-4 shrink-0" />
              ) : (
                <Info aria-hidden className="text-fg-muted mt-0.5 size-4 shrink-0" />
              )}
              <span>{r.text}</span>
            </li>
          ))}
        </ul>
        <p className="text-fg-muted text-xs">Phiên {row.signalDateText}</p>
        <Inputs inputs={row.inputs} />
      </>
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{row.ruleName}</h3>
        <span className="border-border inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-medium">
          <span aria-hidden>{row.directionGlyph}</span>
          {row.directionText}
        </span>
      </div>
      <p className="text-sm tabular-nums">{row.valueText}</p>
      <p className="text-fg-muted text-xs">Phiên {row.signalDateText}</p>
      <Inputs inputs={row.inputs} />
    </>
  );
}

function Inputs({ inputs }: { inputs: InputVM[] }) {
  if (inputs.length === 0) return null;
  return (
    <details className="text-sm">
      <summary className="flex min-h-11 cursor-pointer items-center">Dữ liệu đầu vào ({inputs.length})</summary>
      <ul className="space-y-2 pb-2">
        {inputs.map((i) => (
          <li key={`${i.kindLabel}|${i.refText}`} className="text-fg-muted text-xs">
            <span className="text-fg font-medium">{i.kindLabel}</span> <span className="break-all">{i.refText}</span>
            {i.sourceText && <span className="block">{i.sourceText}</span>}
            {i.fetchedAtText && <span className="block">{i.fetchedAtText}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
