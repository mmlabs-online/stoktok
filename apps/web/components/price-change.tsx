import { formatPercent, formatPrice } from '@stoktok/core';
import type { PriceTone } from '@stoktok/core';
import { TONE_STYLES } from './tone';

export function PriceChange({
  change,
  changePct,
  tone,
}: {
  change: number;
  /** integer ppm (1% = 10_000) */
  changePct?: number;
  tone: PriceTone;
}) {
  const s: { text: string; glyph: string; tag?: string; srLabel: string } = TONE_STYLES[tone];
  return (
    <span className={`num inline-flex items-center gap-1 ${s.text}`}>
      <span aria-hidden>{s.glyph}</span>
      <span>{formatPrice(change, { signed: true })}</span>
      {changePct !== undefined && <span>({formatPercent(changePct, { signed: true })})</span>}
      {s.tag && <span className="text-xs font-semibold">{s.tag}</span>}
      <span className="sr-only">{s.srLabel}</span>
    </span>
  );
}
