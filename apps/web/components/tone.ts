import type { PriceTone } from '@stoktok/core';

export interface ToneStyle {
  text: string;
  bg: string;
  glyph: string;
  tag?: string;
  srLabel: string;
}

/** The only tone -> class/glyph map. Color never carries meaning alone. */
export const TONE_STYLES = {
  up: { text: 'text-price-up', bg: 'bg-price-up-bg', glyph: '▲', srLabel: 'tăng' },
  down: { text: 'text-price-down', bg: 'bg-price-down-bg', glyph: '▼', srLabel: 'giảm' },
  ref: { text: 'text-price-ref', bg: 'bg-price-ref-bg', glyph: '■', srLabel: 'đứng giá' },
  ceiling: {
    text: 'text-price-ceiling',
    bg: 'bg-price-ceiling-bg',
    glyph: '▲',
    tag: 'Trần',
    srLabel: 'giá trần',
  },
  floor: {
    text: 'text-price-floor',
    bg: 'bg-price-floor-bg',
    glyph: '▼',
    tag: 'Sàn',
    srLabel: 'giá sàn',
  },
} as const satisfies Record<PriceTone, ToneStyle>;
