import { pathToFileURL } from 'node:url';
import type { Db } from '@stoktok/db';
import { createPgDb } from '@stoktok/db/pg';
import { EOD_SYNC_CONFIG, FINANCIAL_STATEMENTS_SYNC_CONFIG, FINANCIALS_SYNC_CONFIG, HOLIDAY_GAPS_CONFIG, NEWS_SYNC_CONFIG, SIGNALS_JOB_CONFIG, isFinancialsSourceId, isNewsSourceId, isPriceSourceId } from './config';
import type { FinancialsSourceId, NewsSourceId, PriceSourceId } from './config';
import { runEodSync } from './jobs/eod-sync';
import { runFinancialStatementsSync } from './jobs/financial-statements-sync';
import { runFinancialsSync } from './jobs/financials-sync';
import { runMediumSignals } from './jobs/medium-signals';
import { runNewsSync } from './jobs/news-sync';
import { runResolveHolidayGaps } from './jobs/resolve-holiday-gaps';
import { TCBS_FINANCIALS_EPS_BASIS, TCBS_FINANCIALS_SOURCE_NAME } from './sources/tcbs-financials';
import { VCI_IQ_FINANCIALS_EPS_BASIS, VCI_IQ_FINANCIALS_SOURCE_NAME, VciIqFinancialsSource } from './sources/vci-iq-financials';
import { createNewsSources } from './sources/news-source';
import { createFinancialsSource } from './sources/select-financials-source';
import { createPriceSource } from './sources/select-price-source';
import { createDbEodStore, createDbFinancialsStore, createDbFinancialStatementsStore, createDbHolidayGapsStore, createDbNewsStore, createDbSignalsStore } from './store';

export type ParsedArgs =
  | { ok: true; job: 'eod-prices' | 'financials' | 'financial-statements' | 'signals' | 'resolve-holiday-gaps' | 'news'; dryRun: boolean; backfillTradingDays?: number; source?: PriceSourceId | FinancialsSourceId | NewsSourceId }
  | { ok: false; usage: string };

const USAGE = 'usage: cli.ts <eod-prices|financials|financial-statements|signals|resolve-holiday-gaps|news> [--dry-run] [--backfill [<tradingDays>]  (eod-prices only)] [--source <vci-public|tcbs-public>  (eod-prices) | <vci-iq|tcbs-public>  (financials)]  | <cafef|vietstock|vnexpress>  (news)]  (financial-statements takes --dry-run only)';

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [job, ...flags] = argv;
  if (job !== 'eod-prices' && job !== 'financials' && job !== 'financial-statements' && job !== 'signals' && job !== 'resolve-holiday-gaps' && job !== 'news') return { ok: false, usage: USAGE };
  let dryRun = false;
  let backfillTradingDays: number | undefined;
  let source: PriceSourceId | FinancialsSourceId | NewsSourceId | undefined;
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (f === '--dry-run') {
      if (dryRun) return { ok: false, usage: USAGE };
      dryRun = true;
    } else if (f === '--backfill') {
      if (job !== 'eod-prices' || backfillTradingDays !== undefined) return { ok: false, usage: USAGE };
      const next = flags[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        if (!/^\d+$/.test(next)) return { ok: false, usage: USAGE };
        backfillTradingDays = Number(next);
        i += 1;
      } else {
        backfillTradingDays = EOD_SYNC_CONFIG.backfillDefaultTradingDays;
      }
      if (backfillTradingDays < 1 || backfillTradingDays > EOD_SYNC_CONFIG.backfillMaxTradingDays) {
        return { ok: false, usage: USAGE };
      }
    } else if (f === '--source') {
      const next = flags[i + 1];
      if (job === 'resolve-holiday-gaps' || job === 'financial-statements') return { ok: false, usage: USAGE };
      if (source !== undefined || next === undefined) return { ok: false, usage: USAGE };
      if (job === 'eod-prices' && isPriceSourceId(next)) source = next;
      else if (job === 'financials' && isFinancialsSourceId(next)) source = next;
      else if (job === 'news' && isNewsSourceId(next)) source = next;
      else return { ok: false, usage: USAGE };
      i += 1;
    } else {
      return { ok: false, usage: USAGE };
    }
  }
  return { ok: true, job, dryRun, ...(source !== undefined ? { source } : {}), ...(backfillTradingDays !== undefined ? { backfillTradingDays } : {}) };
}

/** `openDb` is injectable for tests; the handle is opened only after the arguments parse, and always ended. */
export async function main(argv: readonly string[], openDb: () => Db = () => createPgDb(process.env, 'worker')): Promise<void> {
  const args = parseArgs(argv);
  if (!args.ok) {
    console.error(args.usage);
    process.exitCode = 2;
    return;
  }
  const log = (message: string) => console.error(message);
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  let db: Db | undefined;
  try {
    db = openDb();
    let summary: { ok: boolean };
    if (args.job === 'resolve-holiday-gaps') {
      summary = await runResolveHolidayGaps({
        store: createDbHolidayGapsStore(db),
        now: new Date(),
        config: HOLIDAY_GAPS_CONFIG,
        log,
        dryRun: args.dryRun,
      });
    } else if (args.job === 'news') {
      const c = NEWS_SYNC_CONFIG;
      const only = args.source !== undefined && isNewsSourceId(args.source) ? args.source : undefined;
      summary = await runNewsSync({
        store: createDbNewsStore(db, { insertChunkSize: c.insertChunkSize }),
        sources: createNewsSources(c, { fetchImpl: fetch, http: { timeoutMs: c.timeoutMs, maxAttempts: c.maxAttempts, backoffBaseMs: c.backoffBaseMs, sleep, log } }).filter((s) => only === undefined || s.id === only),
        now: new Date(),
        config: c,
        sleep,
        log,
        dryRun: args.dryRun,
      });
    } else if (args.job === 'signals') {
      summary = await runMediumSignals({
        store: createDbSignalsStore(db, SIGNALS_JOB_CONFIG),
        now: new Date(),
        log,
        dryRun: args.dryRun,
        epsBasisBySource: {
          [TCBS_FINANCIALS_SOURCE_NAME]: TCBS_FINANCIALS_EPS_BASIS,
          [VCI_IQ_FINANCIALS_SOURCE_NAME]: VCI_IQ_FINANCIALS_EPS_BASIS,
        },
      });
    } else if (args.job === 'financial-statements') {
      const c = FINANCIAL_STATEMENTS_SYNC_CONFIG;
      summary = await runFinancialStatementsSync({
        store: createDbFinancialStatementsStore(db, { upsertChunkSize: c.upsertChunkSize, linesSymbolChunk: c.linesSymbolChunk }),
        source: new VciIqFinancialsSource({
          fetchImpl: fetch,
          http: { timeoutMs: c.timeoutMs, maxAttempts: c.maxAttempts, backoffBaseMs: c.backoffBaseMs, sleep, log },
          requestDelayMs: c.requestDelayMs,
        }),
        now: new Date(),
        config: c,
        sleep,
        log,
        dryRun: args.dryRun,
      });
    } else if (args.job === 'financials') {
      const c = FINANCIALS_SYNC_CONFIG;
      const source = createFinancialsSource(
        args.source !== undefined && isFinancialsSourceId(args.source) ? args.source : c.financialsSource,
        { fetchImpl: fetch, http: { timeoutMs: c.timeoutMs, maxAttempts: c.maxAttempts, backoffBaseMs: c.backoffBaseMs, sleep, log } },
      );
      summary = await runFinancialsSync({
        store: createDbFinancialsStore(db, { upsertChunkSize: c.upsertChunkSize }),
        source,
        now: new Date(),
        config: c,
        sleep,
        log,
        dryRun: args.dryRun,
      });
    } else {
      const c = EOD_SYNC_CONFIG;
      const source = createPriceSource(args.source !== undefined && isPriceSourceId(args.source) ? args.source : c.priceSource, {
        fetchImpl: fetch,
        http: { timeoutMs: c.timeoutMs, maxAttempts: c.maxAttempts, backoffBaseMs: c.backoffBaseMs, sleep, log },
      });
      summary = await runEodSync({
        store: createDbEodStore(db, { upsertChunkSize: c.upsertChunkSize }),
        source,
        now: new Date(),
        config: c,
        sleep,
        log,
        dryRun: args.dryRun,
        ...(args.backfillTradingDays !== undefined ? { backfillTradingDays: args.backfillTradingDays } : {}),
      });
    }
    console.log(JSON.stringify(summary));
    process.exitCode = summary.ok ? 0 : 1;
  } finally {
    await db?.end().catch(() => undefined);
  }
}

// Run only as the entry point, so tests can import parseArgs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : 'job failed');
    process.exitCode = 1;
  });
}
