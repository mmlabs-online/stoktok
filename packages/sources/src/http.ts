import { SourceError } from './source-error';

export interface GetJsonOptions {
  timeoutMs: number;
  maxAttempts: number;
  backoffBaseMs: number;
  userAgent: string;
  /** Max response body size in bytes (default DEFAULT_MAX_BODY_BYTES). */
  maxBodyBytes?: number;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
}

export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

interface RequestInitLite {
  method: 'GET' | 'POST';
  body?: string;
}

/** Polite client: only User-Agent and Accept (plus Content-Type for POST) are sent. Retries network errors, 429 and 5xx with backoff. */
export function getJson(fetchImpl: typeof fetch, url: string, o: GetJsonOptions): Promise<unknown> {
  return requestJson(fetchImpl, url, { method: 'GET' }, o);
}

/** Same policy as getJson, with a JSON body. No caller-supplied headers (no browser-like headers by design). */
export function postJson(fetchImpl: typeof fetch, url: string, body: unknown, o: GetJsonOptions): Promise<unknown> {
  return requestJson(fetchImpl, url, { method: 'POST', body: JSON.stringify(body) }, o);
}

async function requestJson(fetchImpl: typeof fetch, url: string, init: RequestInitLite, o: GetJsonOptions): Promise<unknown> {
  let last: SourceError | undefined;
  for (let attempt = 1; attempt <= o.maxAttempts; attempt++) {
    if (attempt > 1) {
      const delay = o.backoffBaseMs * 2 ** (attempt - 2);
      o.log(`retry ${attempt - 1}/${o.maxAttempts - 1} in ${delay} ms: ${last?.message ?? 'error'}`);
      await o.sleep(delay);
    }
    try {
      const res = await fetchImpl(url, {
        ...(init.method === 'POST' ? { method: 'POST', body: init.body } : {}),
        headers: {
          'User-Agent': o.userAgent,
          Accept: 'application/json',
          ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        redirect: 'error',
        signal: AbortSignal.timeout(o.timeoutMs),
      });
      if (res.ok) {
        let text: string;
        try {
          text = await readCapped(res, o.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
        } catch (e) {
          if (e instanceof SourceError) throw e;
          throw new SourceError('failed to read response body', true, res.status);
        }
        try {
          return JSON.parse(text);
        } catch {
          throw new SourceError('response is not valid JSON', false, res.status);
        }
      }
      const retryable = res.status === 429 || res.status >= 500;
      last = new SourceError(`HTTP ${res.status}`, retryable, res.status);
    } catch (e) {
      if (e instanceof SourceError) throw e;
      last = new SourceError(`network error: ${e instanceof Error ? e.name : 'unknown'}`, true);
    }
    if (!last.retryable) throw last;
  }
  throw last ?? new SourceError('no attempt made', true);
}

async function readCapped(res: Response, max: number): Promise<string> {
  const tooBig = () => new SourceError(`response body exceeds ${max} bytes`, false, res.status);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw tooBig();
  if (!res.body) {
    const t = await res.text();
    if (new TextEncoder().encode(t).length > max) throw tooBig();
    return t;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw tooBig();
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}
