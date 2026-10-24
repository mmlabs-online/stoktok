import { DEFAULT_PRICE_SANITY, normalizeDailyBar, vnDateOf } from '@stoktok/core';
import type { PriceSanity, PriceUnit, RawDailyBar } from '@stoktok/core';
import { TCBS_CONFIG } from '../config';
import { getJson } from './http';
import type { GetJsonOptions } from './http';
import { SourceError } from './price-source';
import type { FetchResult, PriceSource, RejectedBar } from './price-source';

/**
 * UNVERIFIED (sandbox cannot reach VN hosts; see docs/adr/0001-eod-price-source.md): the unit,
 * raw-vs-adjusted prices and the tradingDate encoding follow a recalled response shape. If the unit
 * is wrong, core normalizeDailyBar rejects the bars (unit guard) instead of storing them.
 */
export const TCBS_PRICE_UNIT: PriceUnit = 'VND';

export interface TcbsOptions {
  fetchImpl: typeof fetch;
  http: Omit<GetJsonOptions, 'userAgent'>;
  baseUrl?: string;
  userAgent?: string;
  sanity?: PriceSanity;
}

const vnStartSeconds = (date: string) => Math.floor(Date.parse(`${date}T00:00:00+07:00`) / 1000);
const vnEndSeconds = (date: string) => Math.floor(Date.parse(`${date}T23:59:59+07:00`) / 1000);

export class TcbsPriceSource implements PriceSource {
  readonly name = 'tcbs-public';

  constructor(private readonly o: TcbsOptions) {}

  url(symbol: string, fromDate: string, toDate: string): string {
    const q = new URLSearchParams({
      ticker: symbol,
      type: 'stock',
      resolution: 'D',
      from: String(vnStartSeconds(fromDate)),
      to: String(vnEndSeconds(toDate)),
    });
    return `${this.o.baseUrl ?? TCBS_CONFIG.baseUrl}/stock-insight/v1/stock/bars-long-term?${q}`;
  }

  async fetchDaily(symbol: string, fromDate: string, toDate: string, ctx: { lastClose?: number }): Promise<FetchResult> {
    const body = await getJson(this.o.fetchImpl, this.url(symbol, fromDate, toDate), {
      ...this.o.http,
      userAgent: this.o.userAgent ?? TCBS_CONFIG.userAgent,
    });
    const data = (body as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) throw new SourceError('unexpected response shape: data is not an array', false);

    const bars: FetchResult['bars'] = [];
    const rejected: RejectedBar[] = [];
    for (const item of data as unknown[]) {
      if (typeof item !== 'object' || item === null) {
        rejected.push({ reason: 'invalid_bar' });
        continue;
      }
      const b = item as Record<string, unknown>;
      const tradeDate = toVnDate(b.tradingDate);
      if (tradeDate !== undefined && (tradeDate < fromDate || tradeDate > toDate)) continue;
      const raw: RawDailyBar = { open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, tradeDate };
      const r = normalizeDailyBar(symbol, raw, TCBS_PRICE_UNIT, this.o.sanity ?? DEFAULT_PRICE_SANITY, ctx.lastClose);
      if (r.ok) bars.push(r.bar);
      else rejected.push({ ...(tradeDate !== undefined ? { tradeDate } : {}), reason: r.reason });
    }
    return { bars, rejected };
  }
}

function toVnDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : vnDateOf(d);
}
