## Attempt 1 — 2026-11-05
Verdict: PASS

Scope: slice 1 only (Ming's approved split). Reviewed `git diff origin/main...HEAD`; the implementation is commit 7c46c0f.

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` passed in all 5 projects (core, db, sources, web, worker); no errors.
- lint: `pnpm lint` passed in all 5 projects; no errors or warnings.
- test: core 577 passed (44 files); sources 20 passed, 1 file skipped (`vci-intraday.samples.test.ts`, no live samples yet, as planned); db 128 passed + 1 todo; worker 229 passed (14 files); web 266 passed (35 files). These match impl-log.md.
- db:check: `pnpm db:check` passed on local Postgres: apply, checks, full rollback, re-apply, checks again ("db:check OK").

### Acceptance criteria
- [x] 1a: `prices_intraday` migration, rollback and checks. Evidence: `supabase/migrations/20261105000200_prices_intraday.sql` has PK (symbol, ts), `price integer`, `volume bigint`, `source`/`fetched_at` not null, RLS enabled, revoke from public/anon/authenticated, grants to service_role only. The rollback drops the table. `checks.sql` adds the table to tables_exist, the bigint/integer/not-null asserts, `service_role_can_read_write_prices_intraday` (upsert on conflict) and 6 bad-row rejects. The existing generic checks (rls_enabled_all_tables, no_grants_anon_authenticated_public, and the anon/authenticated denial loop) cover the new table. db:check is green.
- [x] 1b: server-only batched adapter, config-driven, R3 guard. Evidence: `vci-intraday.test.ts` › "batches symbols in one POST" (1 call, body from config, only UA/Accept/Content-Type headers sent), "chunks above maxSymbolsPerRequest", 403/429/503 cases. Endpoint, path, timeFrame, countBack, toLeadSeconds, UA and timeouts all come from `VCI_INTRADAY_CONFIG` (`packages/sources/src/config.ts`). `r3-guard.test.ts` regex is extended to `@stoktok/sources` and passes.
- [x] 1c: repo stores with source and fetched_at; core rejects bad quotes. Evidence: `prices-intraday.test.ts` › upsert uses `onConflict: 'symbol,ts'`, rows carry source + fetched_at, later duplicate wins, chunked, no select; getLatestIntraday sends one query per symbol (eq, order ts desc, limit 1, maybeSingle), omits not-found symbols and maps bigint string volume to a number. `intraday.test.ts` › 12 reject cases (invalid_ts/price, band, step, close_jump, volume) plus the THOUSAND_VND case.
- [x] 3a: session rule is a pure core function with table tests. Evidence: `packages/core/src/market/intraday.ts` `isInIntradayWindow`; test.each covers 08:59 through 15:03, UTC input, weekend, holiday and the day after, and a custom config. `validateIntradayConfig` has 10 reject cases.
- [x] 5: EOD jobs unchanged. Evidence: the diff stat touches no `apps/worker/src/jobs/**`, `vci.ts`, `tcbs.ts` or `select-price-source.ts`. The only worker source edits are the `http.ts` and `price-source.ts` shims. All 229 worker tests pass.
- [x] 6a: live-check script, opt-in samples test, ADR 0006, green checks. Evidence: `work/tickets/STK-049/record-vci-intraday-samples.sh` sends only the honest UA, Accept and Content-Type and exits on 403. `vci-intraday.samples.test.ts` uses `describe.skipIf` (skipped now). `docs/adr/0006-intraday-prices-on-demand.md` contains the decision, the spec deviation, the UNVERIFIED list and the 7-item checklist. Checks are green as listed above.
- [x] Move is behaviour-neutral (the plan wanted a separate commit; it was squashed into one, so I checked by reading). `diff <(git show origin/main:apps/worker/src/sources/http.ts) packages/sources/src/http.ts` differs only in the `SourceError` import line. `source-error.ts` is the same class body. `http.test.ts` is a 98% rename and only the import changed. The worker shims re-export the same symbols, so existing `import { SourceError } from './price-source'` keeps working (one class, so `instanceof` still holds). The tsup `noExternal` and the Dockerfile manifest COPY lines are correct.

### Issues
None.

### Rules R1–R10
No violations found. R1: no UI in this slice. R2: integer and bigint columns; `toVnd` plus the integer and step guards. R3: server-only package with the guard extended; web does not import it. R4: source and fetched_at are not null in the DB and set by the adapter. R5: session windows, grace and every source tuning value are config. R6: no new server entry points. R7: scope matches the plan file list (`toLeadSeconds` is an extra config key, which is in the spirit of R5). R8: core logic has unit tests. R10: public market data only, no login or orders.

### Nits (do not block)
- `packages/core/src/market/intraday.test.ts`: the "only yesterday" case uses `1_793_000_000 - 2 days`, which is about 2026-10-25, not yesterday. It still proves "not today", but `sec('2026-11-04', '14:59')` would match the label.
- `intradayQuoteFromRow` passes `row.ts` through as-is. PostgREST returns `+00:00` rather than the `.000Z` that the adapter writes. Slice 2 should compare `ts` values as instants, not as strings.
- The move was not a separate commit, as the plan asked (`Approach §1`). Verified by reading instead.

### Follow-ups (out of scope)
- Slice 2: add `@stoktok/sources` to the web `transpilePackages` (already noted in impl-log).
- The plan's follow-ups (a) to (i) stand unchanged.

## Attempt 2 — 2026-11-05
Verdict: PASS

Scope: rework 1, which Ming asked for (ticket note of 2026-11-05) to fix the security-review.md 🟡 items: script exit code and `--max-time`, and `redirect: 'error'` plus a body size cap in `http.ts`. The implementation is commit 4aa7781 (HEAD~1 is the orchestrator's state commit). I also re-read the whole ticket diff (`git diff origin/main...HEAD`).

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` passed in all 5 projects.
- lint: `pnpm lint` passed in all 5 projects, with no warnings.
- test: core 577 (44 files); sources 24 (2 files, 1 skipped: the samples test, as planned); db 128 + 1 todo; worker 229 (14 files); web 266 (35 files). All passed, exit 0. These match impl-log.md attempt 2. Sources went from 20 to 24, which is the 4 new `safety limits` tests. Worker is still 229.

### Acceptance criteria
- [x] Security 🟡: live-check script exits non-zero on failed calls and has `--max-time`. Evidence: `record-vci-intraday-samples.sh`:
  - Each gap-chart `post` sets `FAILED=1` on failure.
  - The final line `exit 1`s if `FAILED` is set.
  - 403 still stops at once.
  - curl has `--connect-timeout 10 --max-time 15`. A timeout gives `000`, which takes the non-200 path, so `return 1` and `FAILED=1`.
  - The board call stays `|| true`, because it is info only.
  - Headers are unchanged: the honest UA, Accept and Content-Type only.
- [x] Security 🟡: `http.ts` uses `redirect: 'error'`. Evidence: `packages/sources/src/http.ts:47`; test `safety limits › requests are sent with redirect: error`. A redirect TypeError maps to a retryable `network error: TypeError` (test "a redirect … is a SourceError after retries").
- [x] Security 🟡: response size cap. Evidence:
  - `readCapped` (`http.ts:75-99`) first checks `content-length`. If the header is missing or junk, the result is 0 or NaN and the code falls through to the stream count.
  - The stream count is on decompressed bytes, and the reader is cancelled when the cap is passed.
  - The default is 5 MiB, with an optional `maxBodyBytes` per call.
  - Over the cap gives a non-retryable `SourceError('response body exceeds N bytes')`. Tests: "body over maxBodyBytes" (1 call, no retry) and "declared content-length over the cap… body at the cap passes" (7-byte `{"a":1}` with cap 7).
- [x] EOD jobs unchanged, and the mock changes do not change behaviour (as the caller asked). Evidence:
  - `git diff HEAD~1..HEAD -U0 -- apps/worker` has only the 7 mock lines (`json: async () => x` → `text: async () => JSON.stringify(x), headers: new Headers()`). No assertion, expected value or test name changed. No worker source or job file was touched.
  - The parsed values are the same, because `JSON.parse(JSON.stringify(x))` round-trips the plain fixtures.
  - The one semantic mock is `vci.test.ts` "200 with non-JSON body". It used a rejecting `json()`; now `text()` returns `'<html>'`. `JSON.parse` throws, so the same `'response is not valid JSON'`, non-retryable path runs, and the assertion is unchanged.
  - The `{ ok: false, status }` mocks (tcbs-financials, vci-iq-financials) need no change, because the non-ok path never reads the body or headers.
  - Runtime policy for EOD: the only change is the client-wide `redirect: 'error'` and the 5 MiB cap, which Ming asked for. EOD payloads are far below the cap: VCI is one symbol per request with at most 400 daily bars (`apps/worker/src/config.ts:47`), and the fixtures are under 400 B. A server-side redirect on the EOD/financials hosts would now fail, as a retryable error, instead of being followed. This is intended, and there is a follow-up below to watch the first run.
- [x] Attempt-1 criteria still hold. Nothing else in the slice changed, and checks are green as listed above.

### Issues
None.

### Rules R1–R10
No violations found. R3: no client code is touched. R5: the cap is an option with a default in the source package (a client safety limit, not a market rule). R7: the scope is the two 🟡 items Ming asked for. The worker test mock edits are out of plan but justified in impl-log ("Out-of-plan files"), and they are mechanically required by the `res.json()` → capped text read change. R8: the new `http.ts` behaviour has unit tests.

### Nits (do not block)
- The `failed to read response body` (retryable) branch in `http.ts:55-57` has no test, for example a body stream that errors mid-read.
- A redirect is retried up to `maxAttempts` before failing, as impl-log says. That is harmless but noisy for the EOD client (`maxAttempts` > 1). It could be classed non-retryable in a later ticket.
- The `ticket.md` `Attempts` field still says 1. That is orchestrator bookkeeping.

### Follow-ups (out of scope)
- After deploy, check the first scheduled EOD and financials runs for `network error: TypeError`. That would mean a host now redirects, which the client used to follow silently.
- Slice 2 (STK-050): the `apps/web/server/sources.ts` `server-only` pin and the `transpilePackages` entry, as already noted.
