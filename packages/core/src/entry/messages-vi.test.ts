import { describe, expect, it } from 'vitest';
import { entryMessage } from './messages-vi';
import type { EntryErrorCode } from './messages-vi';

const CODES: EntryErrorCode[] = [
  'REQUIRED', 'NOT_INTEGER', 'TOO_LARGE', 'SYMBOL_INVALID', 'DATE_INVALID', 'DATE_IN_FUTURE', 'SIDE_INVALID',
  'PRICE_NOT_POSITIVE', 'PRICE_LOW_UNCONFIRMED', 'QTY_NOT_POSITIVE', 'QTY_NOT_LOT', 'FEE_REQUIRED_NO_RATE',
  'TAX_REQUIRED_NO_RATE', 'OVERSELL_SELF', 'OVERSELL_OTHER', 'LEDGER_INVALID', 'CA_TYPE_UNSUPPORTED',
  'AMOUNT_NOT_POSITIVE', 'RATIO_NOT_POSITIVE', 'DATE_BEFORE_EX', 'CA_DUPLICATE', 'NOT_FOUND', 'SAVE_FAILED',
];

describe('entryMessage', () => {
  it('has a non-empty Vietnamese message for every code', () => {
    for (const code of CODES) expect(entryMessage(code).length).toBeGreaterThan(5);
  });
  it('interpolates quantities and the DD/MM/YYYY date in OVERSELL messages', () => {
    const params = { symbol: 'FPT', date: '2026-10-14', requested: 1400, sellable: 1000 };
    for (const code of ['OVERSELL_SELF', 'OVERSELL_OTHER'] as const) {
      const m = entryMessage(code, params);
      expect(m).toContain('1.400');
      expect(m).toContain('1.000');
      expect(m).toContain('14/10/2026');
      expect(m).toContain('FPT');
    }
  });
  it('includes the lot size in QTY_NOT_LOT', () => {
    expect(entryMessage('QTY_NOT_LOT', { lotSize: 100 })).toContain('100');
  });
});
