import { expect, test } from 'vitest';
import { EOD_SYNC_CONFIG, VCI_CONFIG } from './config';

test('VCI max request span covers lookback and backfill chunk', () => {
  const n = Math.max(EOD_SYNC_CONFIG.lookbackTradingDays, EOD_SYNC_CONFIG.backfillChunkTradingDays);
  expect(VCI_CONFIG.maxCalendarDaysPerRequest).toBeGreaterThanOrEqual(Math.ceil((n * 7) / 5) + 30);
});
