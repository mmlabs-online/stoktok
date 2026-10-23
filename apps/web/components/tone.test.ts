import { PRICE_TONES } from '@stoktok/core';
import { describe, expect, it } from 'vitest';
import { TONE_STYLES } from './tone';

describe('TONE_STYLES', () => {
  it('every PriceTone has class, glyph and sr label', () => {
    for (const t of PRICE_TONES) {
      const s: { text: string; glyph: string; srLabel: string } = TONE_STYLES[t];
      expect(s.text).not.toBe('');
      expect(s.glyph).not.toBe('');
      expect(s.srLabel).not.toBe('');
    }
    expect((TONE_STYLES.ceiling as { tag: string }).tag).toBe('Trần');
    expect((TONE_STYLES.floor as { tag: string }).tag).toBe('Sàn');
  });
});
