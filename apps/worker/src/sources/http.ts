import { SourceError } from './price-source';

export interface GetJsonOptions {
  timeoutMs: number;
  maxAttempts: number;
  backoffBaseMs: number;
  userAgent: string;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
}

/** Polite client: only User-Agent and Accept are sent. Retries network errors, 429 and 5xx with backoff. */
export async function getJson(fetchImpl: typeof fetch, url: string, o: GetJsonOptions): Promise<unknown> {
  let last: SourceError | undefined;
  for (let attempt = 1; attempt <= o.maxAttempts; attempt++) {
    if (attempt > 1) {
      const delay = o.backoffBaseMs * 2 ** (attempt - 2);
      o.log(`retry ${attempt - 1}/${o.maxAttempts - 1} in ${delay} ms: ${last?.message ?? 'error'}`);
      await o.sleep(delay);
    }
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': o.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(o.timeoutMs),
      });
      if (res.ok) {
        try {
          return await res.json();
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
