import { expect, test } from 'vitest';
import { EOD_SYNC_CONFIG, FINANCIALS_SYNC_CONFIG, VCI_CONFIG, VCI_IQ_CONFIG } from './config';

test('VCI max request span covers lookback and backfill chunk', () => {
  const n = Math.max(EOD_SYNC_CONFIG.lookbackTradingDays, EOD_SYNC_CONFIG.backfillChunkTradingDays);
  expect(VCI_CONFIG.maxCalendarDaysPerRequest).toBeGreaterThanOrEqual(Math.ceil((n * 7) / 5) + 30);
});

test('financials source defaults to vci-iq', () => {
  expect(FINANCIALS_SYNC_CONFIG.financialsSource).toBe('vci-iq');
});

test('VCI IQ user agent is honest: stoktok, no browser tokens', () => {
  expect(VCI_IQ_CONFIG.userAgent).toMatch(/^stoktok\//);
  for (const token of ['Mozilla', 'Chrome', 'Safari', 'AppleWebKit']) expect(VCI_IQ_CONFIG.userAgent).not.toContain(token);
});
