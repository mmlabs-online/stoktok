import { NEWS_GAP_TYPE, NEWS_LINK_CONFIG, NEWS_SYMBOL_ALIASES, dedupeNewsItems, isTradingDay, linkSymbols, normalizeNewsItem, normalizeSymbol, planNewsGap, vnDateOf } from '@stoktok/core';
import type { NewsItem, NewsRejectReason, Result } from '@stoktok/core';
import type { DataGapInsert, NewsInsert, OpenGapRecord } from '@stoktok/db';
import type { NewsSyncConfig } from '../config';
import type { NewsSource } from '../sources/news-source';

export { NEWS_GAP_TYPE };

export interface NewsStore {
  getHolidays(): Promise<readonly string[]>;
  listWatchlistSymbols(): Promise<string[]>;
  listHeldSymbols(asOf: string): Promise<Result<string[]>>;
  /** Returns the number of rows actually inserted (a stored url is skipped). */
  insertNews(rows: NewsInsert[]): Promise<number>;
  /** Open `news` gaps of one source id. */
  listOpenGaps(source: string): Promise<OpenGapRecord[]>;
  insertGaps(rows: DataGapInsert[]): Promise<void>;
  extendGaps(ids: number[], toTs: string): Promise<void>;
  resolveGaps(ids: number[], resolvedAt: string): Promise<void>;
}

export interface NewsSyncDeps {
  store: NewsStore;
  sources: readonly NewsSource[];
  now: Date;
  config: NewsSyncConfig;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
  dryRun: boolean;
}

export interface NewsSourceSummary {
  feeds: number;
  failedFeeds: number;
  skippedFeeds: number;
  items: number;
  rejectedByReason: Partial<Record<NewsRejectReason, number>>;
}

export interface NewsSyncSummary {
  ok: boolean;
  job: 'news';
  dryRun: boolean;
  skipped?: 'non_trading_day';
  fetchedAt: string;
  perSource: Record<string, NewsSourceSummary>;
  itemsInserted: number;
  duplicatesInBatch: number;
  gapsRecorded: number;
  gapsExtended: number;
  gapsResolved: number;
  failedSources: string[];
  ledgerError?: string;
}

const empty = (): NewsSyncSummary => ({
  ok: true,
  job: 'news',
  dryRun: false,
  fetchedAt: '',
  perSource: {},
  itemsInserted: 0,
  duplicatesInBatch: 0,
  gapsRecorded: 0,
  gapsExtended: 0,
  gapsResolved: 0,
  failedSources: [],
});

const errName = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

/**
 * Hourly news collection. Orchestration only: cleaning, linking and gap rules are in core (R1). One failing source is
 * a gap for that source and never stops the others (R4). Logs name sources, feeds and counts, never article text (R9).
 */
export async function runNewsSync(deps: NewsSyncDeps): Promise<NewsSyncSummary> {
  const { store, sources, now, config, sleep, log } = deps;
  const fetchedAt = now.toISOString();
  const summary: NewsSyncSummary = { ...empty(), dryRun: deps.dryRun, fetchedAt };

  const holidays = await store.getHolidays();
  if (!isTradingDay(vnDateOf(now), holidays)) return { ...summary, skipped: 'non_trading_day' };

  const candidates = new Set<string>(Object.keys(NEWS_SYMBOL_ALIASES));
  const raw = await store.listWatchlistSymbols();
  const held = await store.listHeldSymbols(vnDateOf(now));
  if (held.ok) raw.push(...held.value);
  else summary.ledgerError = held.error.code;
  for (const r of raw) {
    const s = normalizeSymbol(r);
    if (s) candidates.add(s);
    else log('warn: skipping invalid symbol');
  }

  const all: NewsItem[] = [];
  const failed = new Set<string>();
  for (const source of sources) {
    const s: NewsSourceSummary = { feeds: 0, failedFeeds: 0, skippedFeeds: 0, items: 0, rejectedByReason: {} };
    summary.perSource[source.id] = s;
    let consecutive = 0;
    try {
      for (let i = 0; i < source.feedUrls.length; i++) {
        const url = source.feedUrls[i] as string;
        if (consecutive >= config.maxConsecutiveFeedFailures) {
          s.skippedFeeds += 1;
          continue;
        }
        if (i > 0) await sleep(source.minIntervalMs);
        s.feeds += 1;
        try {
          const rawItems = await source.fetchFeed(url);
          let valid = 0;
          for (const r of rawItems) {
            const n = normalizeNewsItem(r, {
              source: source.name,
              credibility: source.credibility,
              linkHosts: source.linkHosts,
              upgradeHttps: source.upgradeHttps,
              fetchedAt,
              maxTitleChars: config.maxTitleChars,
              maxExcerptChars: config.maxExcerptChars,
              maxFutureMs: config.maxFutureMs,
            });
            if (!n.ok) {
              s.rejectedByReason[n.reason] = (s.rejectedByReason[n.reason] ?? 0) + 1;
              continue;
            }
            valid += 1;
            all.push({ ...n.item, symbols: linkSymbols([n.item.title, n.item.excerpt], { candidates, aliases: NEWS_SYMBOL_ALIASES, config: NEWS_LINK_CONFIG }) });
          }
          s.items += valid;
          // A 200 with nothing usable means the feed changed or broke: treat as a failure so the gap is recorded.
          if (valid === 0) throw new Error('feed has no valid items');
          consecutive = 0;
        } catch (e) {
          s.failedFeeds += 1;
          consecutive += 1;
          failed.add(source.id);
          log(`feed failed: ${source.id} ${url}: ${errName(e)}`);
        }
      }
      if (s.skippedFeeds > 0) failed.add(source.id);
    } catch (e) {
      failed.add(source.id);
      log(`source failed: ${source.id}: ${errName(e)}`);
    }
  }

  const items = dedupeNewsItems(all);
  summary.duplicatesInBatch = all.length - items.length;
  summary.failedSources = sources.map((s) => s.id).filter((id) => failed.has(id));
  summary.ok = summary.failedSources.length === 0 && summary.ledgerError === undefined;
  if (deps.dryRun) return summary;

  // Rows first, gaps after: a crash in between leaves rows stored and the previous gap state, which a rerun repairs.
  summary.itemsInserted = await store.insertNews(
    items.map((i) => ({ url: i.url, title: i.title, excerpt: i.excerpt, source: i.source, credibility: i.credibility, published_at: i.publishedAt, fetched_at: i.fetchedAt, symbols: i.symbols })),
  );
  for (const source of sources) {
    const open = await store.listOpenGaps(source.id);
    const plan = planNewsGap({ failed: failed.has(source.id), openGaps: open, now, gapLookbackMs: config.gapLookbackMs });
    if (plan.insert) {
      await store.insertGaps([{ symbol: null, data_type: NEWS_GAP_TYPE, from_ts: plan.insert.from, to_ts: plan.insert.to, source: source.id, fetched_at: fetchedAt }]);
      summary.gapsRecorded += 1;
    }
    if (plan.extendIds.length > 0) {
      await store.extendGaps(plan.extendIds, fetchedAt);
      summary.gapsExtended += plan.extendIds.length;
    }
    if (plan.resolveIds.length > 0) {
      await store.resolveGaps(plan.resolveIds, fetchedAt);
      summary.gapsResolved += plan.resolveIds.length;
    }
  }
  return summary;
}
