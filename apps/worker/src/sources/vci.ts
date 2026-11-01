import { DEFAULT_PRICE_SANITY, normalizeDailyBar, vnDateOf } from '@stoktok/core';
import type { PriceSanity, PriceUnit, RawDailyBar } from '@stoktok/core';
import { VCI_CONFIG } from '../config';
import { postJson } from './http';
import type { GetJsonOptions } from './http';
import { SourceError } from './price-source';
import type { FetchResult, PriceSource, RejectedBar } from './price-source';

export const VCI_PRICE_SOURCE_NAME = 'vci-public';

/**
 * UNVERIFIED (sandbox cannot reach VN hosts; see docs/adr/0004-vci-eod-price-source.md): the unit,
 * raw-vs-adjusted prices and the `t` encoding follow vnstock's reading of the endpoint. If the unit
 * is wrong, core normalizeDailyBar rejects the bars (unit guard) instead of storing them.
 */
export const VCI_PRICE_UNIT: PriceUnit = 'VND';

export interface VciOptions {
  fetchImpl: typeof fetch;
  http: Omit<GetJsonOptions, 'userAgent'>;
  baseUrl?: string;
  userAgent?: string;
  sanity?: PriceSanity;
  maxCalendarDaysPerRequest?: number;
}

const DAY_MS = 86_400_000;
const dayMs = (date: string) => Date.parse(`${date}T00:00:00Z`);
const dayAfter = (date: string) => new Date(dayMs(date) + DAY_MS).toISOString().slice(0, 10);
const calendarDaysInclusive = (from: string, to: string) => Math.round((dayMs(to) - dayMs(from)) / DAY_MS) + 1;
const vnStartSeconds = (date: string) => Math.floor(Date.parse(`${date}T00:00:00+07:00`) / 1000);

/** Strict number parsing: numbers pass, plain digit strings convert, anything else is left for core to reject. */
function num(x: unknown): unknown {
  if (typeof x === 'string' && /^\d+(\.\d+)?$/.test(x)) return Number(x);
  return x;
}

export class VciPriceSource implements PriceSource {
  readonly name = VCI_PRICE_SOURCE_NAME;

  constructor(private readonly o: VciOptions) {}

  requestBody(symbol: string, fromDate: string, toDate: string) {
    return {
      timeFrame: 'ONE_DAY',
      symbols: [symbol],
      to: vnStartSeconds(dayAfter(toDate)),
      countBack: calendarDaysInclusive(fromDate, toDate),
    };
  }

  async fetchDaily(symbol: string, fromDate: string, toDate: string, ctx: { lastClose?: number }): Promise<FetchResult> {
    const body = this.requestBody(symbol, fromDate, toDate);
    if (body.countBack > (this.o.maxCalendarDaysPerRequest ?? VCI_CONFIG.maxCalendarDaysPerRequest)) {
      throw new SourceError('requested range too long', false);
    }
    let root: unknown;
    try {
      root = await postJson(this.o.fetchImpl, `${this.o.baseUrl ?? VCI_CONFIG.baseUrl}${VCI_CONFIG.chartPath}`, body, {
        ...this.o.http,
        userAgent: this.o.userAgent ?? VCI_CONFIG.userAgent,
      });
    } catch (e) {
      if (e instanceof SourceError && e.status === 403) {
        throw new SourceError('blocked by source (HTTP 403); no bypass, see ADR 0004', false, 403);
      }
      throw e;
    }

    const list = Array.isArray(root) ? root : (root as { data?: unknown } | null)?.data;
    if (!Array.isArray(list)) throw new SourceError('unexpected response shape', false);
    if (list.length === 0) return { bars: [], rejected: [] };
    const item = list[0] as unknown;
    if (typeof item !== 'object' || item === null) throw new SourceError('unexpected response shape', false);
    const cols = item as Record<string, unknown>;
    if (typeof cols.symbol === 'string' && cols.symbol.toUpperCase() !== symbol.toUpperCase()) {
      throw new SourceError('symbol mismatch', false);
    }
    const { t, o, h, l, c, v } = cols;
    if (![t, o, h, l, c, v].every(Array.isArray)) throw new SourceError('unexpected response shape', false);
    const [ts = [], os = [], hs = [], ls = [], cs = [], vs = []] = [t, o, h, l, c, v] as unknown[][];
    const n = ts.length;
    if ([os, hs, ls, cs, vs].some((a) => a.length !== n)) {
      throw new SourceError('unexpected response shape', false);
    }
    if (n > body.countBack) throw new SourceError('unexpected response shape: more bars than requested', false);

    const bars: FetchResult['bars'] = [];
    const rejected: RejectedBar[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < n; i++) {
      const tn = num(ts[i]);
      const tradeDate =
        typeof tn === 'number' && Number.isSafeInteger(tn) && tn >= 0 ? vnDateOf(new Date(tn * 1000)) : undefined;
      if (tradeDate !== undefined && (tradeDate < fromDate || tradeDate > toDate)) continue;
      if (tradeDate !== undefined) {
        if (seen.has(tradeDate)) {
          rejected.push({ tradeDate, reason: 'duplicate_trade_date' });
          continue;
        }
        seen.add(tradeDate);
      }
      const raw: RawDailyBar = {
        open: num(os[i]),
        high: num(hs[i]),
        low: num(ls[i]),
        close: num(cs[i]),
        volume: num(vs[i]),
        tradeDate,
      };
      const r = normalizeDailyBar(symbol, raw, VCI_PRICE_UNIT, this.o.sanity ?? DEFAULT_PRICE_SANITY, ctx.lastClose);
      if (r.ok) bars.push(r.bar);
      else rejected.push({ ...(tradeDate !== undefined ? { tradeDate } : {}), reason: r.reason });
    }
    return { bars, rejected };
  }
}
