import { formatVnd } from '@stoktok/core';
import type { PriceTone } from '@stoktok/core';
import { TONE_STYLES } from './tone';

export function MoneyText({
  vnd,
  signed,
  tone,
  symbol,
}: {
  vnd: number | null | undefined;
  signed?: boolean;
  tone?: PriceTone;
  symbol?: boolean;
}) {
  const color = tone ? TONE_STYLES[tone].text : '';
  return (
    <span className={`num ${color}`.trim()}>
      {vnd == null ? '—' : formatVnd(vnd, { signed, symbol })}
    </span>
  );
}
