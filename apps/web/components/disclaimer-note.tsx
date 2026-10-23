import { Info } from 'lucide-react';

export const DISCLAIMER_TEXT = 'Thông tin chỉ mang tính tham khảo, không phải khuyến nghị đầu tư';

export function DisclaimerNote({ className }: { className?: string }) {
  return (
    <p className={`text-fg-muted flex items-start gap-2 text-xs ${className ?? ''}`.trim()}>
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{DISCLAIMER_TEXT}</span>
    </p>
  );
}
