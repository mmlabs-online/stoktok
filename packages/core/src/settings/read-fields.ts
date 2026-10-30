import { formatQuantity } from '../format';
import type { EntryError } from '../entry/messages-vi';
import { formatRatePercentInput, parseIntegerInput, parseRatePercentInput } from '../entry/parse-input';

export type Bounds = { min: number; max: number };

export const percentRange = (b: Bounds): EntryError => ({
  code: 'OUT_OF_RANGE',
  params: { min: `${formatRatePercentInput(b.min)}%`, max: `${formatRatePercentInput(b.max)}%` },
});

export const intRange = (b: Bounds): EntryError => ({
  code: 'OUT_OF_RANGE',
  params: { min: formatQuantity(b.min), max: formatQuantity(b.max) },
});

export function readPercent(text: string, b: Bounds, blank: 'null' | 'required'): { value: number | null } | { error: EntryError } {
  if (blank === 'null' && text.trim() === '') return { value: null };
  const r = parseRatePercentInput(text, { maxPpm: b.max });
  if (r.ok) return r.ppm < b.min ? { error: percentRange(b) } : { value: r.ppm };
  switch (r.code) {
    case 'NEGATIVE':
    case 'TOO_LARGE':
      return { error: percentRange(b) };
    case 'INVALID':
      return { error: { code: 'PERCENT_INVALID' } };
    case 'TOO_PRECISE':
      return { error: { code: 'PERCENT_TOO_PRECISE' } };
    case 'REQUIRED':
      return { error: { code: 'REQUIRED' } };
  }
}

export function readInteger(text: string, b: Bounds): { value: number } | { error: EntryError } {
  const r = parseIntegerInput(text, { max: b.max });
  if (!r.ok) {
    if (r.code === 'NOT_INTEGER') {
      return { error: text.trim().startsWith('-') ? intRange(b) : { code: 'WHOLE_NUMBER_INVALID' } };
    }
    return { error: r.code === 'TOO_LARGE' ? intRange(b) : { code: r.code } };
  }
  return r.value < b.min ? { error: intRange(b) } : { value: r.value };
}
