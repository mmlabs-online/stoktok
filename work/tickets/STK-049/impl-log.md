## Attempt 1 — 2026-11-05 (slice 1)

### Files touched
| File | Required because |
|---|---|
| packages/sources/{package.json,tsconfig.json,vitest.config.ts,src/index.ts} | New `@stoktok/sources` package (plan) |
| packages/sources/src/http.ts, http.test.ts | Moved from apps/worker/src/sources unchanged (only the SourceError import path) |
| packages/sources/src/source-error.ts | `SourceError` moved out of worker price-source.ts, unchanged |
| apps/worker/src/sources/http.ts, price-source.ts | Re-export shims (worker imports unchanged) |
| apps/worker/package.json, tsup.config.ts, apps/{web,worker}/Dockerfile, pnpm-lock.yaml | Workspace dep, bundle inlining, manifest COPY, lockfile |
| packages/sources/src/config.ts, vci-intraday.ts | `VCI_INTRADAY_CONFIG`, `VciIntradaySource`, `IntradaySource` |
| packages/sources/src/__fixtures__/vci-intraday.synthetic.json | Synthetic fixture (VNM, FPT, HPG with zero bars) |
| packages/core/src/market/intraday.ts, index.ts | Session rule, config, quote reduction |
| supabase/migrations/20261105000200_prices_intraday.sql, rollback/…down.sql | Table, RLS, grants |
| scripts/db-check/checks.sql | tables_exist, column types, not-null, service_role upsert, bad-row rejects |
| packages/db/src/{rows,mappers,index}.ts, repos/prices-intraday.ts | Typed repo (upsert, getLatestIntraday) |
| packages/db/src/r3-guard.test.ts | Guard regex extended to @stoktok/sources |
| docs/adr/0006-intraday-prices-on-demand.md | Decision, UNVERIFIED list, go/no-go checklist |
| work/tickets/STK-049/record-vci-intraday-samples.sh | Ming's live check script |

### Tests added / changed
- packages/core/src/market/intraday.test.ts › isInIntradayWindow (edges, UTC input, weekend/holiday, custom config), validateIntradayConfig, intradayQuoteFromMinuteBars (newest/volume, 12 rejects, THOUSAND_VND)
- packages/sources/src/vci-intraday.test.ts › batching, chunking, fixture parse, absent symbol, mismatch/duplicate, shape errors, empty list, 403, 429/503, lastCloses
- packages/sources/src/vci-intraday.samples.test.ts › skipped (no live-samples yet)
- packages/sources/src/http.test.ts › moved
- packages/db/src/repos/prices-intraday.test.ts › upsert, getLatestIntraday
- packages/db/src/r3-guard.test.ts › extended regex
- scripts/db-check/checks.sql › new blocks

### Checks (actual output summary)
- typecheck: all 5 projects Done, no errors
- lint: all Done, no errors or warnings
- test: core 577 passed; sources 20 passed (1 file skipped); db 128 passed, 1 todo; worker 229 passed; web 266 passed
- build: worker and web Done
- db:check: OK (local Postgres, apply, rollback, re-apply)

### Out-of-plan files
None. (`apps/web/next.config` `transpilePackages` is not changed: web does not import sources yet.)

### Follow-ups (noticed, not done)
- Plan asked the move as a separate commit; nothing is committed per the caller's instruction, so the move and new code are in one working tree.
- The `t`/`c`/`v` fields are read only; `o/h/l` are ignored by design.
- Add `@stoktok/sources` to web `transpilePackages` and Dockerfile build in slice 2.

### Scope self-check
- Could the diff be smaller? No.
- Diff size: tracked +104 / -157 (the move), plus new files (sources package, core intraday, db repo, migration, ADR, script).

---

## Attempt 2 (REWORK: security-review.md yellow items)

### Files touched
- `record-vci-intraday-samples.sh`: gap-chart failures set FAILED and the script exits 1 at the end (403 still stops at once); curl gets `--connect-timeout 10 --max-time 15`. Headers unchanged (honest only).
- `packages/sources/src/http.ts`: `redirect: 'error'`; optional `maxBodyBytes` (default 5 MiB, `DEFAULT_MAX_BODY_BYTES`); body is read as a capped stream (content-length pre-check) and then JSON-parsed. Over the cap gives non-retryable `SourceError('response body exceeds N bytes')`.
- `packages/sources/src/http.test.ts`: tests for redirect option, redirect-as-error, cap exceeded, content-length cap, body at the cap.
- Existing test mocks (`eod-sync.test.ts`, `tcbs.test.ts`, `tcbs-financials.test.ts`, `vci.test.ts`, `vci-iq-financials.test.ts`, `vci-intraday.test.ts`, `vci-intraday.samples.test.ts`): fake responses changed from `json()` to `text()` + `headers` because the client now reads the body as text. Mock-only change, no assertions changed. Required because the client no longer calls `res.json()`.

### Checks
- typecheck, lint: all Done, clean
- test: core 577, sources 24, db 128 (1 todo), worker 229, web 266 passed
- build: worker and web Done

### Out-of-plan files
The worker test mock edits above (mechanical, needed by the http.ts change).

### Follow-ups
- A redirect surfaces as a fetch TypeError, so it is treated as a retryable network error (up to maxAttempts); harmless but slightly chatty.

### Scope self-check
Only the two yellow items were addressed. Nothing committed.
