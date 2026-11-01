import { pathToFileURL } from 'node:url';
import { createServiceClient } from '@stoktok/db';
import { EOD_SYNC_CONFIG, FINANCIALS_SYNC_CONFIG, SIGNALS_JOB_CONFIG, isFinancialsSourceId, isPriceSourceId } from './config';
import type { FinancialsSourceId, PriceSourceId } from './config';
import { runEodSync } from './jobs/eod-sync';
import { runFinancialsSync } from './jobs/financials-sync';
import { runMediumSignals } from './jobs/medium-signals';
import { TCBS_FINANCIALS_EPS_BASIS, TCBS_FINANCIALS_SOURCE_NAME } from './sources/tcbs-financials';
import { VCI_IQ_FINANCIALS_EPS_BASIS, VCI_IQ_FINANCIALS_SOURCE_NAME } from './sources/vci-iq-financials';
import { createFinancialsSource } from './sources/select-financials-source';
import { createPriceSource } from './sources/select-price-source';
import { createDbEodStore, createDbFinancialsStore, createDbSignalsStore } from './store';

export type ParsedArgs =
  | { ok: true; job: 'eod-prices' | 'financials' | 'signals'; dryRun: boolean; backfillTradingDays?: number; source?: PriceSourceId | FinancialsSourceId }
  | { ok: false; usage: string };

const USAGE = 'usage: cli.ts <eod-prices|financials|signals> [--dry-run] [--backfill [<tradingDays>]  (eod-prices only)] [--source <vci-public|tcbs-public>  (eod-prices) | <vci-iq|tcbs-public>  (financials)]';

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [job, ...flags] = argv;
  if (job !== 'eod-prices' && job !== 'financials' && job !== 'signals') return { ok: false, usage: USAGE };
  let dryRun = false;
  let backfillTradingDays: number | undefined;
  let source: PriceSourceId | FinancialsSourceId | undefined;
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
      if (source !== undefined || next === undefined) return { ok: false, usage: USAGE };
      if (job === 'eod-prices' && isPriceSourceId(next)) source = next;
      else if (job === 'financials' && isFinancialsSourceId(next)) source = next;
      else return { ok: false, usage: USAGE };
      i += 1;
    } else {
      return { ok: false, usage: USAGE };
    }
  }
  return { ok: true, job, dryRun, ...(source !== undefined ? { source } : {}), ...(backfillTradingDays !== undefined ? { backfillTradingDays } : {}) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(args.usage);
    process.exitCode = 2;
    return;
  }
  const log = (message: string) => console.error(message);
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const db = createServiceClient(process.env);
  let summary: { ok: boolean };
  if (args.job === 'signals') {
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
}

// Run only as the entry point, so tests can import parseArgs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : 'job failed');
    process.exitCode = 1;
  });
}
