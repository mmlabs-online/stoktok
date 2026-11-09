export const MAX_NEWS_URL_CHARS = 2048;

// core is built without DOM or Node types; URL is a global in every runtime that uses it (web, worker), so only the used part is declared.
interface UrlLike {
  protocol: string;
  username: string;
  password: string;
  hostname: string;
  host: string;
  pathname: string;
  hash: string;
  searchParams: { entries(): IterableIterator<[string, string]> };
}
declare const URL: new (input: string) => UrlLike;
declare const URLSearchParams: new (init: [string, string][]) => { toString(): string };

export interface CanonicalUrlOptions {
  /** Host allow-list; a subdomain of a listed host is accepted. */
  linkHosts: readonly string[];
  upgradeHttps: boolean;
}

const isTrackingParam = (k: string) => /^utm_/i.test(k) || /^(fbclid|gclid)$/i.test(k);

/** One stable form per article, so the same story from two feeds dedupes by url. Null when the link is unsafe or off-host. */
export function canonicalNewsUrl(raw: string, o: CanonicalUrlOptions): string | null {
  const s = raw.trim();
  if (s.length === 0 || s.length > MAX_NEWS_URL_CHARS) return null;
  let u: UrlLike;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username !== '' || u.password !== '') return null;
  const host = u.hostname.toLowerCase();
  if (!o.linkHosts.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  if (o.upgradeHttps) u.protocol = 'https:';
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !isTrackingParam(k))
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1));
  const query = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : '';
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') || '/' : u.pathname;
  const out = `${u.protocol}//${u.host}${path}${query}`;
  return out.length > MAX_NEWS_URL_CHARS ? null : out;
}
