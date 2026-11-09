import { describe, expect, test } from 'vitest';
import { EOD_SYNC_CONFIG, FINANCIAL_STATEMENTS_SYNC_CONFIG, FINANCIALS_SYNC_CONFIG, NEWS_SOURCE_IDS, NEWS_SYNC_CONFIG, VCI_CONFIG, VCI_IQ_CONFIG, isNewsSourceId } from './config';

test('VCI max request span covers lookback and backfill chunk', () => {
  const n = Math.max(EOD_SYNC_CONFIG.lookbackTradingDays, EOD_SYNC_CONFIG.backfillChunkTradingDays);
  expect(VCI_CONFIG.maxCalendarDaysPerRequest).toBeGreaterThanOrEqual(Math.ceil((n * 7) / 5) + 30);
});

test('financials source defaults to vci-iq', () => {
  expect(FINANCIALS_SYNC_CONFIG.financialsSource).toBe('vci-iq');
});

test("financials nonFailingRejectReasons default is ['unsupported_company_type']", () => {
  expect(FINANCIALS_SYNC_CONFIG.nonFailingRejectReasons).toEqual(['unsupported_company_type']);
});

test('VCI IQ user agent is honest: stoktok, no browser tokens', () => {
  expect(VCI_IQ_CONFIG.userAgent).toMatch(/^stoktok\//);
  for (const token of ['Mozilla', 'Chrome', 'Safari', 'AppleWebKit']) expect(VCI_IQ_CONFIG.userAgent).not.toContain(token);
});

test('FINANCIAL_STATEMENTS_SYNC_CONFIG defaults', () => {
  const c = FINANCIAL_STATEMENTS_SYNC_CONFIG;
  expect([c.maxQuarters, c.lookbackYears, c.maxYears, c.annualPublishLagDays]).toEqual([16, 5, 6, 120]);
  expect(c.publishLagDays).toBe(FINANCIALS_SYNC_CONFIG.publishLagDays);
  expect(c.lookbackQuarters).toBeLessThanOrEqual(c.maxQuarters);
  expect(c.lookbackYears).toBeLessThanOrEqual(c.maxYears);
  expect(c.nonFailingRejectReasons).toEqual(['unsupported_company_type']);
});

describe('NEWS_SYNC_CONFIG', () => {
  test('news feeds are https rss urls on the source host', () => {
    expect(NEWS_SYNC_CONFIG.sources.map((s) => s.id)).toEqual([...NEWS_SOURCE_IDS]);
    for (const s of NEWS_SYNC_CONFIG.sources) {
      expect(s.feedUrls.length).toBeGreaterThan(0);
      for (const u of s.feedUrls) {
        const url = new URL(u);
        expect(url.protocol).toBe('https:');
        expect(url.pathname).toMatch(/\.rss$/);
        expect(s.linkHosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))).toBe(true);
      }
      expect(s.minIntervalMs).toBeGreaterThan(0);
    }
  });
  test('insertChunkSize < 1000 and gapsPageSize <= 1000', () => {
    expect(NEWS_SYNC_CONFIG.insertChunkSize).toBeLessThan(1000);
    expect(NEWS_SYNC_CONFIG.gapsPageSize).toBeLessThanOrEqual(1000);
  });
  test('caps match the database checks; honest user agent', () => {
    expect(NEWS_SYNC_CONFIG.maxExcerptChars).toBeLessThanOrEqual(10_000);
    expect(NEWS_SYNC_CONFIG.maxTitleChars).toBeLessThanOrEqual(500);
    expect(NEWS_SYNC_CONFIG.maxFutureMs).toBe(86_400_000);
    expect(NEWS_SYNC_CONFIG.userAgent).toMatch(/^stoktok\//);
    expect(isNewsSourceId('cafef')).toBe(true);
    expect(isNewsSourceId('x')).toBe(false);
  });
});
