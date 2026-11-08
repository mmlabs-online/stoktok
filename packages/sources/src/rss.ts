import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { RawFeedItem } from '@stoktok/core';
import { SourceError } from './source-error';

const bad = (message: string) => new SourceError(message, false);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/**
 * RSS 2.0 `channel/item` list. Refuses a DOCTYPE (entity expansion) and any declared encoding other than UTF-8.
 * Malformed XML, a missing channel or zero items is a non-retryable SourceError, so the caller records a gap.
 * Nothing in an item (enclosure, image, content) is ever fetched.
 */
export function parseRssFeed(xml: string, opts: { maxItems: number }): RawFeedItem[] {
  const text = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  if (/<!DOCTYPE/i.test(text)) throw bad('feed contains a DOCTYPE');
  const declared = /^\s*<\?xml[^>]*\sencoding\s*=\s*["']([^"']+)["']/i.exec(text)?.[1];
  if (declared !== undefined && !/^utf-?8$/i.test(declared)) throw bad('feed encoding is not UTF-8');
  if (XMLValidator.validate(text) !== true) throw bad('feed is not well-formed XML');
  const doc = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
    isArray: (_name, jpath) => jpath === 'rss.channel.item',
  }).parse(text) as { rss?: { channel?: { item?: unknown[] } } };
  const channel = doc.rss?.channel;
  if (typeof channel !== 'object' || channel === null) throw bad('feed has no channel');
  const items = Array.isArray(channel.item) ? channel.item : [];
  const out: RawFeedItem[] = [];
  for (const it of items) {
    if (typeof it !== 'object' || it === null) continue;
    const r = it as Record<string, unknown>;
    out.push({ title: str(r.title), link: str(r.link), guid: str(r.guid), pubDate: str(r.pubDate), description: str(r.description) });
    if (out.length >= opts.maxItems) break;
  }
  if (out.length === 0) throw bad('feed has no items');
  return out;
}
