import { previousTradingDay } from '../calendar';
import { PPM, assertVnd, mulDiv } from '../money';
import { priceStatus } from '../portfolio/freshness';
import type { PriceStatus } from '../portfolio/freshness';
import type { PriceQuote } from '../portfolio/build-portfolio';
import type { Exchange, MarketRules } from '../settings/market-rules';
import { changeTone, priceTone } from '../tone';
import type { PriceTone } from '../tone';
import type { TickBand } from './config';

/** A stored daily close with its volume (R4: source + fetchedAt come from PriceQuote). */
export type StoredClose = PriceQuote & { volume: number };

function validateBands(bands: readonly TickBand[]): void {
  if (bands.length === 0) throw new RangeError('tick bands must not be empty');
  let prev = 0;
  bands.forEach((band, i) => {
    if (!Number.isSafeInteger(band.step) || band.step <= 0) throw new RangeError('tick step must be a positive integer');
    const last = i === bands.length - 1;
    if (last) {
      if (band.below !== null) throw new RangeError('last tick band must be open-ended');
      return;
    }
    const next = bands[i + 1] as TickBand;
    if (band.below === null || !Number.isSafeInteger(band.below) || band.below <= prev) {
      throw new RangeError('tick bands must be ascending');
    }
    if (band.below % band.step !== 0 || band.below % next.step !== 0) {
      throw new RangeError('tick band edge must be a multiple of the steps on both sides');
    }
    prev = band.below;
  });
}

/** Price step that applies at `price`: the step of the first band whose bound is above it. */
export function tickSize(price: number, bands: readonly TickBand[]): number {
  validateBands(bands);
  for (const band of bands) {
    if (band.below === null || price < band.below) return band.step;
  }
  throw new RangeError('no tick band matches');
}

export function isOnTick(price: number, bands: readonly TickBand[]): boolean {
  return price % tickSize(price, bands) === 0;
}

/**
 * Daily ceiling and floor from a reference price. Raw limit = ref +/- ppm (integer math), then
 * snapped to the tick table: ceiling rounded down, floor rounded up (UNVERIFIED direction).
 */
export function priceLimits(input: {
  ref: number;
  exchange: Exchange;
  rules: Pick<MarketRules, 'priceLimitPpm'>;
  tickBands: Record<Exchange, readonly TickBand[]>;
}): { ceiling: number; floor: number } {
  const ref = assertVnd(input.ref, 'ref');
  if (ref <= 0) throw new RangeError('ref must be positive');
  const bands = input.tickBands[input.exchange];
  if (!isOnTick(ref, bands)) throw new RangeError('ref must be on its tick');
  const ppm = input.rules.priceLimitPpm[input.exchange];
  if (!Number.isSafeInteger(ppm) || ppm < 0 || ppm >= PPM) throw new RangeError('price limit ppm out of range');

  const r = BigInt(ref);
  const million = BigInt(PPM);
  const rawCeiling = (r * (million + BigInt(ppm))) / million;
  const floorNumer = r * (million - BigInt(ppm));
  const rawFloor = (floorNumer + million - 1n) / million;

  const cTick = BigInt(tickSize(Number(rawCeiling), bands));
  const fTick = BigInt(tickSize(Number(rawFloor), bands));
  const ceiling = Number((rawCeiling / cTick) * cTick);
  const floor = Number(((rawFloor + fTick - 1n) / fTick) * fTick);
  if (!(floor <= ref && ref <= ceiling)) throw new RangeError('limits do not bracket the reference');
  return { ceiling, floor };
}

export interface PriceBoardRow {
  symbol: string;
  exchange: Exchange | null;
  close: number | null;
  tradeDate: string | null;
  volume: number | null;
  source: string | null;
  fetchedAt: string | null;
  ref: number | null;
  ceiling: number | null;
  floor: number | null;
  change: number | null;
  /** Change in ppm of the reference (1% = 10,000), rounded half away from zero. */
  changePctPpm: number | null;
  tone: PriceTone | null;
  status: PriceStatus;
  flags: {
    noReference: boolean;
    gapped: boolean;
    exDate: boolean;
    exchangeUnknown: boolean;
    refOffTick: boolean;
  };
}

/**
 * One price-board row from the last stored closes (newest first, 0..2). The reference is the
 * previous stored close, only when it is the previous trading day and the session is not an
 * ex-date; otherwise reference, change and limits stay null (never guessed). Never throws on mapped data.
 */
export function buildPriceBoardRow(input: {
  symbol: string;
  bars: readonly StoredClose[];
  exchange: Exchange | null;
  rules: Pick<MarketRules, 'priceLimitPpm'>;
  tickBands: Record<Exchange, readonly TickBand[]>;
  expectedDate: string;
  holidays: readonly string[];
  exDates: readonly string[];
}): PriceBoardRow {
  const { symbol, exchange } = input;
  const last = input.bars[0];
  const prev = input.bars[1];
  const flags = {
    noReference: false,
    gapped: false,
    exDate: false,
    exchangeUnknown: exchange === null,
    refOffTick: false,
  };
  const row: PriceBoardRow = {
    symbol,
    exchange,
    close: null,
    tradeDate: null,
    volume: null,
    source: null,
    fetchedAt: null,
    ref: null,
    ceiling: null,
    floor: null,
    change: null,
    changePctPpm: null,
    tone: null,
    status: priceStatus(last, input.expectedDate),
    flags,
  };
  if (!last) return row;
  row.close = last.close;
  row.tradeDate = last.tradeDate;
  row.volume = last.volume;
  row.source = last.source;
  row.fetchedAt = last.fetchedAt;

  if (input.exDates.includes(last.tradeDate)) {
    flags.exDate = true;
    return row;
  }
  if (!prev) {
    flags.noReference = true;
    return row;
  }
  if (prev.tradeDate !== previousTradingDay(last.tradeDate, input.holidays)) {
    flags.gapped = true;
    return row;
  }

  if (prev.close > 0) {
    row.ref = prev.close;
    row.change = last.close - prev.close;
    row.changePctPpm = mulDiv(row.change, PPM, prev.close);
    if (exchange !== null) {
      if (isOnTick(prev.close, input.tickBands[exchange])) {
        const limits = priceLimits({ ref: prev.close, exchange, rules: input.rules, tickBands: input.tickBands });
        row.ceiling = limits.ceiling;
        row.floor = limits.floor;
      } else {
        flags.refOffTick = true;
      }
    }
  }

  if (row.ref !== null && row.ceiling !== null && row.floor !== null) {
    row.tone = priceTone({ price: last.close, ref: row.ref, ceiling: row.ceiling, floor: row.floor });
  } else if (row.change !== null) {
    row.tone = changeTone(row.change);
  }
  if (row.status === 'stale' && (row.tone === 'ceiling' || row.tone === 'floor') && row.change !== null) {
    row.tone = changeTone(row.change);
  }
  return row;
}

/** Holdings come from the ledger; a watched symbol that is also held is shown once, in holdings. */
export function splitWatchlistGroups(
  held: readonly string[],
  watched: readonly string[],
): { holdings: string[]; watching: string[]; alsoWatched: string[] } {
  const heldSet = new Set(held);
  const watchedSet = new Set(watched);
  const sort = (xs: Iterable<string>) => [...xs].sort();
  return {
    holdings: sort(heldSet),
    watching: sort([...watchedSet].filter((s) => !heldSet.has(s))),
    alsoWatched: sort([...watchedSet].filter((s) => heldSet.has(s))),
  };
}
