import { DEFAULT_PRICE_SANITY, intradayQuoteFromMinuteBars, vnDateOf } from '@stoktok/core';
import type { IntradayQuote, PriceSanity, PriceUnit, RawMinuteBar } from '@stoktok/core';
import { VCI_INTRADAY_CONFIG } from './config';
import { postJson } from './http';
import type { GetJsonOptions } from './http';
import { SourceError } from './source-error';

/** Same reading of the endpoint as the EOD source (ADR 0004); a wrong unit is caught by the core price guards. */
export const VCI_INTRADAY_PRICE_UNIT: PriceUnit = 'VND';

export interface IntradayFetchResult {
  quotes: IntradayQuote[];
  rejected: { symbol: string; reason: string }[];
}

/** Latest price per symbol, batched. Implementations return integer VND (R2) and set `source` + `fetchedAt` (R4). */
export interface IntradaySource {
  readonly name: string;
  fetchLatest(symbols: readonly string[], ctx: { now: Date; lastCloses?: Readonly<Record<string, number>> }): Promise<IntradayFetchResult>;
}

export interface VciIntradayOptions {
  fetchImpl: typeof fetch;
  http: Omit<GetJsonOptions, 'userAgent'>;
  baseUrl?: string;
  userAgent?: string;
  sanity?: PriceSanity;
  maxSymbolsPerRequest?: number;
}

/** Strict number parsing: numbers pass, plain digit strings convert, anything else is left for core to reject. */
function num(x: unknown): unknown {
  if (typeof x === 'string' && /^\d+(\.\d+)?$/.test(x)) return Number(x);
  return x;
}

const shapeError = () => new SourceError('unexpected response shape', false);

export class VciIntradaySource implements IntradaySource {
  readonly name = VCI_INTRADAY_CONFIG.sourceName;

  constructor(private readonly o: VciIntradayOptions) {}

  async fetchLatest(
    symbols: readonly string[],
    ctx: { now: Date; lastCloses?: Readonly<Record<string, number>> },
  ): Promise<IntradayFetchResult> {
    const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const size = this.o.maxSymbolsPerRequest ?? VCI_INTRADAY_CONFIG.maxSymbolsPerRequest;
    const result: IntradayFetchResult = { quotes: [], rejected: [] };
    for (let i = 0; i < unique.length; i += size) {
      const part = await this.fetchChunk(unique.slice(i, i + size), ctx);
      result.quotes.push(...part.quotes);
      result.rejected.push(...part.rejected);
    }
    return result;
  }

  private async fetchChunk(
    chunk: string[],
    ctx: { now: Date; lastCloses?: Readonly<Record<string, number>> },
  ): Promise<IntradayFetchResult> {
    const body = {
      timeFrame: VCI_INTRADAY_CONFIG.timeFrame,
      symbols: chunk,
      to: Math.floor(ctx.now.getTime() / 1000) + VCI_INTRADAY_CONFIG.toLeadSeconds,
      countBack: VCI_INTRADAY_CONFIG.countBack,
    };
    let root: unknown;
    try {
      root = await postJson(this.o.fetchImpl, `${this.o.baseUrl ?? VCI_INTRADAY_CONFIG.baseUrl}${VCI_INTRADAY_CONFIG.chartPath}`, body, {
        ...this.o.http,
        userAgent: this.o.userAgent ?? VCI_INTRADAY_CONFIG.userAgent,
      });
    } catch (e) {
      if (e instanceof SourceError && e.status === 403) {
        throw new SourceError('blocked by source (HTTP 403); no bypass, see ADR 0006', false, 403);
      }
      throw e;
    }

    const list = Array.isArray(root) ? root : (root as { data?: unknown } | null)?.data;
    if (!Array.isArray(list)) throw shapeError();

    const requested = new Set(chunk);
    const seen = new Set<string>();
    const result: IntradayFetchResult = { quotes: [], rejected: [] };
    const today = vnDateOf(ctx.now);
    for (const item of list as unknown[]) {
      if (typeof item !== 'object' || item === null) throw shapeError();
      const cols = item as Record<string, unknown>;
      const symbol = typeof cols.symbol === 'string' ? cols.symbol.toUpperCase() : undefined;
      if (symbol === undefined || !requested.has(symbol)) throw new SourceError('symbol mismatch', false);
      const { t, c, v } = cols;
      if (![t, c, v].every(Array.isArray)) throw shapeError();
      const [ts = [], cs = [], vs = []] = [t, c, v] as unknown[][];
      if (cs.length !== ts.length || vs.length !== ts.length) throw shapeError();
      if (seen.has(symbol)) {
        result.rejected.push({ symbol, reason: 'duplicate_symbol' });
        continue;
      }
      seen.add(symbol);
      const bars: RawMinuteBar[] = ts.map((_, i) => ({ t: num(ts[i]), c: num(cs[i]), v: num(vs[i]) }));
      const lastClose = ctx.lastCloses?.[symbol];
      const r = intradayQuoteFromMinuteBars(symbol, bars, {
        today,
        unit: VCI_INTRADAY_PRICE_UNIT,
        sanity: this.o.sanity ?? DEFAULT_PRICE_SANITY,
        ...(lastClose !== undefined ? { lastClose } : {}),
        source: this.name,
        fetchedAt: ctx.now.toISOString(),
      });
      if (r.ok) result.quotes.push(r.quote);
      else result.rejected.push({ symbol, reason: r.reason });
    }
    for (const symbol of chunk) if (!seen.has(symbol)) result.rejected.push({ symbol, reason: 'no_data' });
    return result;
  }
}
