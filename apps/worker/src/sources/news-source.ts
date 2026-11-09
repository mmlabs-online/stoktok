import type { NewsCredibility, RawFeedItem } from '@stoktok/core';
import { getText, parseRssFeed } from '@stoktok/sources';
import type { GetJsonOptions } from '@stoktok/sources';
import type { NewsSourceConfig, NewsSourceId, NewsSyncConfig } from '../config';

/** One news outlet. Implementations are swappable (spec 4.3); each returns raw items only, cleaning is in core. */
export interface NewsSource {
  readonly id: NewsSourceId;
  /** Display name stored in `news.source` (R4). */
  readonly name: string;
  readonly credibility: NewsCredibility;
  readonly feedUrls: readonly string[];
  readonly linkHosts: readonly string[];
  readonly upgradeHttps: boolean;
  readonly minIntervalMs: number;
  /** Throws SourceError on a failed request or an unreadable feed. */
  fetchFeed(url: string): Promise<RawFeedItem[]>;
}

export interface RssNewsSourceDeps {
  fetchImpl: typeof fetch;
  http: Omit<GetJsonOptions, 'userAgent' | 'maxBodyBytes'>;
  config: Pick<NewsSyncConfig, 'userAgent' | 'accept' | 'maxBodyBytes' | 'maxItemsPerFeed'>;
}

/** RSS 2.0 over the polite HTTP client (User-Agent and Accept only, no redirects, no cookies). */
export class RssNewsSource implements NewsSource {
  readonly id: NewsSourceId;
  readonly name: string;
  readonly credibility: NewsCredibility;
  readonly feedUrls: readonly string[];
  readonly linkHosts: readonly string[];
  readonly upgradeHttps: boolean;
  readonly minIntervalMs: number;

  constructor(
    cfg: NewsSourceConfig,
    private readonly deps: RssNewsSourceDeps,
  ) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.credibility = cfg.credibility;
    this.feedUrls = cfg.feedUrls;
    this.linkHosts = cfg.linkHosts;
    this.upgradeHttps = cfg.upgradeHttps;
    this.minIntervalMs = cfg.minIntervalMs;
  }

  async fetchFeed(url: string): Promise<RawFeedItem[]> {
    const { config, http, fetchImpl } = this.deps;
    const xml = await getText(fetchImpl, url, { ...http, userAgent: config.userAgent, maxBodyBytes: config.maxBodyBytes, accept: config.accept });
    return parseRssFeed(xml, { maxItems: config.maxItemsPerFeed });
  }
}

/** One source per enabled entry of the configuration. */
export function createNewsSources(config: NewsSyncConfig, deps: Omit<RssNewsSourceDeps, 'config'>): NewsSource[] {
  return config.sources.filter((s) => s.enabled).map((s) => new RssNewsSource(s, { ...deps, config }));
}
