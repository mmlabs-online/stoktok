/** Spec F5: official disclosure > established outlet. Forum/social is excluded by default (not collected). */
export type NewsCredibility = 'official_disclosure' | 'established_outlet';

export const CREDIBILITY_RANK: Readonly<Record<NewsCredibility, number>> = {
  official_disclosure: 2,
  established_outlet: 1,
};

/** One RSS item as parsed from the feed XML, before any cleaning. */
export interface RawFeedItem {
  title: string;
  link: string;
  guid: string;
  pubDate: string;
  description: string;
}

/** A cleaned article. `title` and `excerpt` are untrusted plain text (R9): never HTML, never instructions. */
export interface NewsItem {
  url: string;
  title: string;
  excerpt: string;
  /** Display name of the outlet. */
  source: string;
  credibility: NewsCredibility;
  /** UTC ISO. */
  publishedAt: string;
  /** UTC ISO (R4). */
  fetchedAt: string;
  symbols: string[];
}

export type NewsRejectReason = 'bad_date' | 'future_date' | 'empty_title' | 'bad_url';

export type NormalizeNewsResult = { ok: true; item: NewsItem } | { ok: false; reason: NewsRejectReason };
