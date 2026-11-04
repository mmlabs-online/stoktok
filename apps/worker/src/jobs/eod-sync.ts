import {
  ADJUSTED_HISTORY_REASON,
  DEFAULT_PRICE_CUTOFF_MINUTES_VN,
  PRICES_GAP_TYPE,
  expectedPriceDate,
  holidayOnlyGapIds,
  normalizeSymbol,
  planBackfillChunks,
  planPriceGaps,
  priceGapReadRange,
  subtractTradingDays,
  vnDateOf,
  vnDayBoundsUtc,
} from '@stoktok/core';
import type { GapResolvedReason, Result } from '@stoktok/core';
import type { DataGapInsert, OpenGapRecord, PriceDailyInsert } from '@stoktok/db';
import type { EodSyncConfig } from '../config';
import type { PriceSource } from '../sources/price-source';

export { PRICES_GAP_TYPE };

export interface EodStore {
  getHolidays(): Promise<readonly string[]>;
  listWatchlistSymbols(): Promise<string[]>;
  listHeldSymbols(asOf: string): Promise<Result<string[]>>;
  /** Latest stored close per symbol (integer VND); symbols without a row are omitted. */
  getLatestCloses(symbols: readonly string[]): Promise<Record<string, number>>;
  upsertPricesDaily(rows: PriceDailyInsert[]): Promise<number>;
  /** Stored trade dates of one symbol in [from, to]. */
  listPriceDates(symbol: string, from: string, to: string): Promise<string[]>;
  /** Earliest stored trade date per symbol; symbols without a row are omitted. */
  getFirstPriceDates(symbols: readonly string[]): Promise<Record<string, string>>;
  listOpenGaps(symbols: readonly string[]): Promise<OpenGapRecord[]>;
  insertGaps(rows: DataGapInsert[]): Promise<void>;
  resolveGaps(ids: number[], resolvedAt: string, reason?: GapResolvedReason): Promise<void>;
}

export interface EodDeps {
  store: EodStore;
  source: PriceSource;
  now: Date;
  config: EodSyncConfig;
  sleep: (ms: number) => Promise<void>;
  log: (message: string) => void;
  dryRun: boolean;
  /** One-off backfill: window in trading days, fetched in chunks. Unset = daily sync. */
  backfillTradingDays?: number;
}

export interface EodSummary {
  /**
   * False on any source failure, skipped symbol, ledger error or rejected bar. Exceptions: `adjusted_price_history`
   * rejections do not count (expected for ~20 trading days after a corporate action), unless the newest window of
   * a symbol has a cut-off and zero accepted bars.
   */
  ok: boolean;
  dryRun: boolean;
  source: string;
  fetchedAt: string;
  targetDate: string;
  fromDate: string;
  symbols: string[];
  barsFetched: number;
  rowsUpserted: number;
  rejected: number;
  rejectedBySymbol: Record<string, { tradeDate?: string; reason: string }[]>;
  failedSymbols: string[];
  skippedSymbols: string[];
  symbolsWithoutBars: string[];
  /** Newly recorded missing trading days per symbol (reported on dry-run too). */
  missingDates: Record<string, string[]>;
  /** 0 on dry-run. */
  gapsRecorded: number;
  gapsResolved: number;
  requestsPlanned: number;
  requestsMade: number;
  abortReason?: 'request_cap_exceeded';
  ledgerError?: string;
}

/** Orchestration only: dates, validation and conversion live in core (R1, R2). */
export async function runEodSync(deps: EodDeps): Promise<EodSummary> {
  const { store, source, now, config, log } = deps;
  const holidays = await store.getHolidays();
  const targetDate = expectedPriceDate(now, holidays, DEFAULT_PRICE_CUTOFF_MINUTES_VN);
  const fromDate = subtractTradingDays(targetDate, (deps.backfillTradingDays ?? config.lookbackTradingDays) - 1, holidays);
  const fetchedAt = now.toISOString();

  const raw = await store.listWatchlistSymbols();
  const held = await store.listHeldSymbols(vnDateOf(now));
  let ledgerError: string | undefined;
  if (held.ok) raw.push(...held.value);
  else ledgerError = held.error.code;
  const set = new Set<string>();
  for (const r of raw) {
    const s = normalizeSymbol(r);
    if (s) set.add(s);
    else log(`warn: skipping invalid symbol`);
  }
  const symbols = [...set].sort();

  const backfill = deps.backfillTradingDays !== undefined;
  const chunks = backfill
    ? planBackfillChunks(fromDate, targetDate, config.backfillChunkTradingDays, holidays)
    : [{ from: fromDate, to: targetDate }];
  const requestsPlanned = symbols.length * chunks.length;
  if (backfill) {
    log(`backfill: ${symbols.length} symbols × ${chunks.length} chunks = ${requestsPlanned} requests`);
    if (requestsPlanned > config.maxBackfillRequests) {
      log(`error: backfill aborted, ${requestsPlanned} requests exceed the cap of ${config.maxBackfillRequests}`);
      return {
        ok: false,
        dryRun: deps.dryRun,
        source: source.name,
        fetchedAt,
        targetDate,
        fromDate,
        symbols,
        barsFetched: 0,
        rowsUpserted: 0,
        rejected: 0,
        rejectedBySymbol: {},
        failedSymbols: [],
        skippedSymbols: [],
        symbolsWithoutBars: [],
        missingDates: {},
        gapsRecorded: 0,
        gapsResolved: 0,
        requestsPlanned,
        requestsMade: 0,
        abortReason: 'request_cap_exceeded',
        ...(ledgerError !== undefined ? { ledgerError } : {}),
      };
    }
  }

  const lastCloses = await store.getLatestCloses(symbols);
  const rows: PriceDailyInsert[] = [];
  const rejectedBySymbol: EodSummary['rejectedBySymbol'] = {};
  const failedSymbols: string[] = [];
  const skippedSymbols: string[] = [];
  const symbolsWithoutBars: string[] = [];
  let barsFetched = 0;
  let rejected = 0;
  let adjustedRejected = 0;
  const adjustedNewest: string[] = [];
  let consecutiveFailures = 0;
  let requestsMade = 0;

  for (const symbol of symbols) {
    let failed = false;
    let unmade = false;
    let symbolBars = 0;
    // Newest chunk is checked against the stored latest close; each older chunk against the
    // oldest accepted close of the chunk after it (same close_jump rule, correct reference).
    let lastClose = lastCloses[symbol];
    // Adjusted-history cut-off found so far (newer chunks first): older chunks reject bars on or before it.
    let cutoff: string | undefined;
    let newest = true;
    for (const chunk of chunks) {
      if (consecutiveFailures >= config.maxConsecutiveFailures) {
        unmade = true;
        continue;
      }
      if (requestsMade > 0) await deps.sleep(config.requestDelayMs);
      requestsMade += 1;
      const isNewest = newest;
      newest = false;
      try {
        const res = await source.fetchDaily(symbol, chunk.from, chunk.to, {
          ...(lastClose !== undefined ? { lastClose } : {}),
          ...(cutoff !== undefined ? { rejectOnOrBefore: cutoff } : {}),
        });
        consecutiveFailures = 0;
        barsFetched += res.bars.length;
        symbolBars += res.bars.length;
        if (res.rejected.length > 0) {
          rejected += res.rejected.length;
          adjustedRejected += res.rejected.filter((r) => r.reason === ADJUSTED_HISTORY_REASON).length;
          rejectedBySymbol[symbol] = [...(rejectedBySymbol[symbol] ?? []), ...res.rejected];
        }
        cutoff = res.adjustedCutoff ?? cutoff;
        if (isNewest && res.adjustedCutoff !== undefined && res.bars.length === 0) {
          adjustedNewest.push(symbol);
          log(`error: ${symbol}: newest window is all adjusted history (cut-off ${res.adjustedCutoff})`);
        }
        const oldest = [...res.bars].sort((x, y) => x.tradeDate.localeCompare(y.tradeDate))[0];
        if (oldest) lastClose = oldest.close;
        for (const b of res.bars) {
          rows.push({
            symbol: b.symbol,
            trade_date: b.tradeDate,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume,
            foreign_net: b.foreignNet,
            source: source.name,
            fetched_at: fetchedAt,
          });
        }
      } catch (e) {
        consecutiveFailures += 1;
        failed = true;
        log(`error: ${symbol}: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }
    if (cutoff !== undefined) log(`adjusted history ${symbol}: bars on or before ${cutoff} rejected`);
    if (failed) failedSymbols.push(symbol);
    else if (unmade) skippedSymbols.push(symbol);
    else if (symbolBars === 0) symbolsWithoutBars.push(symbol);
  }

  const rowsUpserted = deps.dryRun ? 0 : await store.upsertPricesDaily(rows);

  // Gap step: a gap is a recorded condition, not a job failure, so it never changes `ok`.
  const openGaps = await store.listOpenGaps(symbols);
  const firstDates = await store.getFirstPriceDates(symbols);
  const gapRows: DataGapInsert[] = [];
  const resolveData: number[] = [];
  const resolveHoliday: number[] = [];
  const missingDates: Record<string, string[]> = {};
  for (const symbol of symbols) {
    const own = openGaps.filter((g) => g.symbol === symbol);
    const range = priceGapReadRange({ windowStart: fromDate, windowEnd: targetDate, openGaps: own });
    const fetched = rows.filter((r) => r.symbol === symbol).map((r) => r.trade_date);
    const storedDates = [...new Set([...(await store.listPriceDates(symbol, range.from, range.to)), ...fetched])];
    const stored = firstDates[symbol];
    const firstStoredDate = [stored, ...fetched].filter((d): d is string => d !== undefined).sort()[0] ?? null;
    const plan = planPriceGaps({ windowStart: fromDate, windowEnd: targetDate, firstStoredDate, storedDates, openGaps: own, holidays });
    const holidayOnly = new Set(holidayOnlyGapIds(own, holidays));
    for (const id of plan.toResolve) (holidayOnly.has(id) ? resolveHoliday : resolveData).push(id);
    if (plan.toRecord.length > 0) {
      missingDates[symbol] = plan.toRecord;
      log(`missing ${symbol}: ${plan.toRecord.join(',')}`);
    }
    for (const d of plan.toRecord) {
      const b = vnDayBoundsUtc(d);
      gapRows.push({ symbol, data_type: PRICES_GAP_TYPE, from_ts: b.fromTs, to_ts: b.toTs, source: source.name, fetched_at: fetchedAt });
    }
  }
  if (!deps.dryRun) {
    await store.insertGaps(gapRows);
    await store.resolveGaps(resolveData, fetchedAt, 'data_stored');
    await store.resolveGaps(resolveHoliday, fetchedAt, 'non_trading_day');
  }

  return {
    ok:
      failedSymbols.length === 0 &&
      skippedSymbols.length === 0 &&
      rejected - adjustedRejected === 0 &&
      adjustedNewest.length === 0 &&
      ledgerError === undefined,
    dryRun: deps.dryRun,
    source: source.name,
    fetchedAt,
    targetDate,
    fromDate,
    symbols,
    barsFetched,
    rowsUpserted,
    rejected,
    rejectedBySymbol,
    failedSymbols,
    skippedSymbols,
    symbolsWithoutBars,
    missingDates,
    gapsRecorded: deps.dryRun ? 0 : gapRows.length,
    gapsResolved: deps.dryRun ? 0 : resolveData.length + resolveHoliday.length,
    requestsPlanned,
    requestsMade,
    ...(ledgerError !== undefined ? { ledgerError } : {}),
  };
}
