import { assertVnd } from './money';

export const PRICE_TONES = ['up', 'down', 'ref', 'ceiling', 'floor'] as const;
export type PriceTone = (typeof PRICE_TONES)[number];

/** Tone of a price against reference, ceiling and floor (integer VND, from configured limits). */
export function priceTone(input: {
  price: number;
  ref: number;
  ceiling: number;
  floor: number;
}): PriceTone {
  const price = assertVnd(input.price, 'price');
  const ref = assertVnd(input.ref, 'ref');
  const ceiling = assertVnd(input.ceiling, 'ceiling');
  const floor = assertVnd(input.floor, 'floor');
  if (floor > ref || ceiling < ref) throw new RangeError('floor must be <= ref <= ceiling');
  if (price >= ceiling) return 'ceiling';
  if (price <= floor) return 'floor';
  if (price === ref) return 'ref';
  return price > ref ? 'up' : 'down';
}

export function changeTone(change: number): 'up' | 'down' | 'ref' {
  assertVnd(change, 'change');
  if (change > 0) return 'up';
  return change < 0 ? 'down' : 'ref';
}
