import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeNewsItem } from '@stoktok/core';
import { parseRssFeed } from '@stoktok/sources';
import { describe, expect, test } from 'vitest';
import { NEWS_SYNC_CONFIG } from '../config';

// Opt-in: runs only after Ming records live feeds with scripts/record-news-fixtures.sh (STK-062 plan, A1).
const DIR = join(__dirname, '..', '..', '..', '..', 'work', 'tickets', 'STK-062', 'live-samples');
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /^(cafef|vietstock|vnexpress)-.*\.xml$/.test(f)) : [];

describe.skipIf(files.length === 0)('recorded news feeds parse', () => {
  // README.md line "recorded_at_utc: <ISO>" is the recording time.
  const recordedAt = files.length ? (/recorded_at_utc:\s*(\S+)/.exec(readFileSync(join(DIR, 'README.md'), 'utf8'))?.[1] ?? '') : '';

  test.each(files)('%s parses and normalizes with 0 bad_url/bad_date', (f) => {
    const sourceId = f.split('-')[0];
    const cfg = NEWS_SYNC_CONFIG.sources.find((s) => s.id === sourceId);
    if (!cfg) throw new Error(`unknown source for ${f}`);
    const raws = parseRssFeed(readFileSync(join(DIR, f), 'utf8'), { maxItems: NEWS_SYNC_CONFIG.maxItemsPerFeed });
    expect(raws.length).toBeGreaterThan(0);
    const reasons: string[] = [];
    let ok = 0;
    for (const r of raws) {
      const n = normalizeNewsItem(r, {
        source: cfg.name,
        credibility: cfg.credibility,
        linkHosts: cfg.linkHosts,
        upgradeHttps: cfg.upgradeHttps,
        fetchedAt: new Date(recordedAt).toISOString(),
        maxTitleChars: NEWS_SYNC_CONFIG.maxTitleChars,
        maxExcerptChars: NEWS_SYNC_CONFIG.maxExcerptChars,
        maxFutureMs: NEWS_SYNC_CONFIG.maxFutureMs,
      });
      if (n.ok) ok += 1;
      else reasons.push(n.reason);
    }
    expect(reasons.filter((x) => x === 'bad_url' || x === 'bad_date')).toEqual([]);
    expect(ok).toBeGreaterThan(0);
  });
});
