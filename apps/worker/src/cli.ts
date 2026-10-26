import { pathToFileURL } from 'node:url';
import { createServiceClient } from '@stoktok/db';
import { EOD_SYNC_CONFIG, FINANCIALS_SYNC_CONFIG, TCBS_CONFIG } from './config';
import { runEodSync } from './jobs/eod-sync';
import { runFinancialsSync } from './jobs/financials-sync';
import { TcbsFinancialsSource } from './sources/tcbs-financials';
import { TcbsPriceSource } from './sources/tcbs';
import { createDbEodStore, createDbFinancialsStore } from './store';

export type ParsedArgs = { ok: true; job: 'eod-prices' | 'financials'; dryRun: boolean } | { ok: false; usage: string };

const USAGE = 'usage: cli.ts <eod-prices|financials> [--dry-run]';

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [job, ...flags] = argv;
  if (job !== 'eod-prices' && job !== 'financials') return { ok: false, usage: USAGE };
  if (flags.some((f) => f !== '--dry-run')) return { ok: false, usage: USAGE };
  return { ok: true, job, dryRun: flags.includes('--dry-run') };
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
  if (args.job === 'financials') {
    const c = FINANCIALS_SYNC_CONFIG;
    const source = new TcbsFinancialsSource({
      fetchImpl: fetch,
      http: { timeoutMs: c.timeoutMs, maxAttempts: c.maxAttempts, backoffBaseMs: c.backoffBaseMs, sleep, log },
      userAgent: TCBS_CONFIG.financialsUserAgent,
      requestDelayMs: c.requestDelayMs,
      maxPeriodsPerResponse: c.maxPeriodsPerResponse,
    });
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
    const source = new TcbsPriceSource({
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
