## Attempt 1 — 2026-10-30
Verdict: PASS

### Checks (run by reviewer)
- typecheck: green (core, db, web, worker)
- lint: green (db, worker, web)
- test: green — core 393/393 (34 files), db 106 passed + 1 todo, worker 93/93 (8 files), web 176/176. Matches impl-log.md.

### Acceptance criteria
- [x] AC1 `--backfill [<n>]` (default from config), same `PriceSource`/validation path, `--dry-run` works — evidence: `apps/worker/src/cli.ts` parseArgs loop + `cli.test.ts › --backfill` (4 tests: n, default, dry-run either order, 0/-5/2.5/abc/>max rejected, max accepted, signals/financials/repeated rejected); `eod-sync.ts` uses `subtractTradingDays(target, n-1)` and `source.fetchDaily` per chunk; `eod-sync.test.ts › backfill › fromDate = …`, `› rows upserted with source.name and fetchedAt`, `› dry-run: no upsert, no insertGaps/resolveGaps, missingDates still reported`. README section added.
- [x] AC2 idempotent, same validation rules — evidence: `› re-run adds no rows`; `› rejected bar in a middle chunk is not written, the prior stored row is kept, ok=false`; `› lastClose: newest chunk gets the stored latest close; older chunks …`. Code check: only `normalizeDailyBar` via `TcbsPriceSource` with `DEFAULT_PRICE_SANITY`; no new validator, `isBeyondDailyLimit` not wired in; no delete; upsert path unchanged.
- [x] AC3 chunked, delays/retries/breaker, bounded + logged — evidence: `packages/core/src/market/backfill.ts` + `backfill.test.ts` (4 tests); `› requestsPlanned = symbols x chunks, logged before the first fetch`; `› planned > maxBackfillRequests: zero fetches, zero writes, ok=false, abortReason`; `› sleep(requestDelayMs) before every request except the first`; `› circuit breaker …`. Retries unchanged in `getJson`. Config keys in `apps/worker/src/config.ts`.
- [x] AC4 fixtures / no network only — evidence: all new tests use `memoryStore`/`fakeSource`; no `fetch` or hosts in the diff.
- [x] Daily-mode regression — `› daily mode unchanged`; existing eod-sync tests unmodified and green.

### Issues
None.

### Rules R1–R10
No violations found. R1/R5: chunk date math in core, all limits in config. R2: no money conversion added. R3: worker only. R4: `source`/`fetched_at` on every row; gap step unchanged. R6: suspended, no auth added (correct). R7: diff matches the plan file list (plus workflow files). R8: new core function has unit tests; checks green. R10: read-only market data.

### Nits (do not block)
- `eod-sync.test.ts` rejected-bar test asserts `m.table.get(...)?.source` is undefined; that also passes if the row were missing. Prefer `expect(m.table.has(\`AAA|${mid.to}\`)).toBe(true)` alongside it.
- Plan A1 says a silently truncated chunk shows up as gaps. That holds for newer chunks, but `planPriceGaps` only expects days from `firstStoredDate`, so truncation (or failure) of the **oldest** chunks of a never-backfilled symbol is not recorded as gaps; it is only visible via `failedSymbols`/`skippedSymbols` or a short `fromDate` coverage on dry-run. Worth one README sentence.
- `eod-sync.ts`: the abort-path summary duplicates the full summary literal; a small helper would avoid drift.

### Follow-ups (out of scope)
- As in plan.md: holiday pre-flight; verify the TCBS `bars-long-term` range cap and raw vs adjusted prices with a recorded fixture; optional ingest reporting of beyond-limit moves in both modes.
- Consider reporting per-symbol earliest stored date after a backfill, so coverage short of the requested window is visible even without failures.
