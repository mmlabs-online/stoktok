import { canonicalNewsUrl } from './canonical-url';
import { capText, toPlainText } from './plain-text';
import { parseRssDate } from './rss-date';
import type { NewsCredibility, NewsItem, NormalizeNewsResult, RawFeedItem } from './types';

export interface NormalizeNewsOptions {
  /** Display name stored in `news.source`. */
  source: string;
  credibility: NewsCredibility;
  linkHosts: readonly string[];
  upgradeHttps: boolean;
  /** UTC ISO of the fetch (R4). */
  fetchedAt: string;
  maxTitleChars: number;
  maxExcerptChars: number;
  /** An item dated further than this after `fetchedAt` is rejected (matches the DB check). */
  maxFutureMs: number;
}

/** One RSS item to a stored-shape article. Symbols are linked separately. A bad item is rejected, never stored with a guess. */
export function normalizeNewsItem(raw: RawFeedItem, o: NormalizeNewsOptions): NormalizeNewsResult {
  const title = capText(toPlainText(raw.title), o.maxTitleChars);
  if (title === '') return { ok: false, reason: 'empty_title' };
  const url = canonicalNewsUrl(raw.link !== '' ? raw.link : raw.guid, { linkHosts: o.linkHosts, upgradeHttps: o.upgradeHttps });
  if (url === null) return { ok: false, reason: 'bad_url' };
  const publishedAt = parseRssDate(raw.pubDate);
  if (publishedAt === null) return { ok: false, reason: 'bad_date' };
  if (Date.parse(publishedAt) > Date.parse(o.fetchedAt) + o.maxFutureMs) return { ok: false, reason: 'future_date' };
  const item: NewsItem = {
    url,
    title,
    excerpt: capText(toPlainText(raw.description), o.maxExcerptChars),
    source: o.source,
    credibility: o.credibility,
    publishedAt,
    fetchedAt: o.fetchedAt,
    symbols: [],
  };
  return { ok: true, item };
}

/** First occurrence per url wins; order is kept. */
export function dedupeNewsItems(items: readonly NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    out.push(it);
  }
  return out;
}
