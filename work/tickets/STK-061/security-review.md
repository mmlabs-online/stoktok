# STK-061 security review

## Attempt 1

## Security review: STK-061, attempt 1

**Verdict: no security blockers.** RLS, grants, service-role scope, secrets and the 403 posture are all correct. I found one correctness bug (🟡, should be fixed before merge) and a few small hardening points. All of this comes from reading the code statically. I did not run the db-check against a live database.

### Findings

**RLS, grants, secrets**
- 🟢 `supabase/migrations/20261108000100_financial_lines.sql:26-28`: RLS is on, there are no policies, and `public, anon, authenticated` are all revoked. Only `service_role` gets select, insert, update and delete. This matches the other tables. Putting the grants in this file, because the earlier grants loop only covered tables that existed then (line 2), is correct.
- 🟢 Table constraints (`:5-17`): regexes on `symbol`, `line` and `period` per `period_kind`, a `statement` enum, non-empty `source`, `fetched_at` not null (R4) and `value bigint not null`. A missing line therefore cannot be stored as null or 0.
- 🟢 `scripts/db-check/checks.sql`: covers this table well:
  - it is in the expected table list (`:34`) and has column asserts (`:149-158`);
  - the general RLS, no-policy, no-grant and anon/authenticated-denied loops (`:173-210`) pick it up automatically;
  - there is a service_role read/write check (`:251-261`) and constraint negatives, including the duplicate key (`:442-457`).
- 🟢 `supabase/rollback/20261108000100_financial_lines.down.sql:1`: a plain `drop table if exists`. Fine.
- 🟢 Service-role exposure (R3): the new code is in `apps/worker` and `packages/db` only. Nothing in `apps/web` touches `financial_lines`, and the only `service_role` hit under `apps/web` is a test file (`server/auth/claims.test.ts`). No new env vars and no `NEXT_PUBLIC_*`.
- 🟢 No secrets in any changed file. The probe sends no credentials.

**External data and the probe script**
- 🟢 `apps/worker/src/sources/vci-iq-financials.ts` handles untrusted API data well:
  - the symbol is normalised and passed through `encodeURIComponent` (`:144`);
  - the response shape is checked (`:263`, `:330`) and the row count is capped (`:331`);
  - rows for the wrong ticker or a duplicated period are rejected, never picked (`:340-363`);
  - field codes come from fixed maps, looked up with `Object.hasOwn` (`:92`), so an unknown company type cannot pick a code;
  - amounts go through `toVndAmount` (safe-integer check) and the `maxAbsTotalVnd` / non-negative guards in core.
  - The 403 is turned into a non-retryable error with no bypass (`:163-165`), and 404 means "no data".
  - Spreading the JSON rows at `:310` cannot pollute the prototype (spread copies `__proto__` as a plain key).
- 🟢 `scripts/probe-vci-iq-cashflow.sh`:
  - honest headers: the same UA as `VCI_IQ_CONFIG.userAgent` (checked against `config.ts:53`), `Accept: application/json`, and `--compressed` (which only adds `Accept-Encoding`);
  - no cookies, Origin or Referer, and no `-L`;
  - one request per symbol, 1 s apart;
  - a 403 stops the script with no retry (`:35-38`);
  - symbols are allow-listed (`:25-27`) and the URL is quoted.
- 🟡 Probe, `scripts/probe-vci-iq-cashflow.sh:31-38`:
  - The body is written to `*.json` whatever the status. A 403/429/5xx error page (HTML) ends up in a file Ming is told to commit as fixture source.
  - A 429 or 5xx does not stop the loop; it keeps hitting the source.
  - There is no `--max-time`.
- 🟡 Integrity bug (R4, not a security hole), `packages/db/src/repos/financial-lines.ts:19`: `listFinancialLines` makes one unpaged PostgREST query.
  - The row volume is about 12 lines × 12 quarters ≈ 144 rows per symbol for quarters, so more than about 7 symbols passes the default 1000-row cap. The rows past the cap are silently dropped.
  - Stored periods then look incomplete in the job (`financial-statements-sync.ts:168-201`). That means **false gaps are recorded**, restatements are missed and open gaps are not resolved.
  - The repo already handles this elsewhere: `fetchAll` paging in `packages/db/src/errors.ts:51` (used by `prices-daily.ts`, `data-gaps.ts`), and the signals store reads in symbol chunks for the same reason (`store.ts:92`). This query also has no `order`, which paging needs.
- 🟢 `apps/worker/src/cli.ts:91-105`: `financial-statements` rejects `--source` (`:48`) and uses the worker's existing db client. Error logs (`financial-statements-sync.ts:143`) contain only the error message, no secrets.
- 🟢 Minor, not a security issue: the DB does not check that a `line` belongs to its `statement` (for example `revenue` + `balance` would be accepted). Only the core registry enforces it.

### Recommendations
1. **(AC "idempotent sync / missing recorded as gap, R4")** Page `listFinancialLines` with `fetchAll` and a stable `order('symbol').order('period').order('line')`, or chunk by symbol in `createDbFinancialStatementsStore` the way the signals store does. Add a repo test with more than one page.
2. **(AC "probe script for cash-flow")**
   - Write each response to a temp file and rename it to `*.json` only on a 200. Log the other statuses.
   - Stop on any status other than 200 or 404, not just 403. That keeps the "no hammering" posture of ADR 0005 for 429 and 5xx too.
   - Add `--max-time 30`.
3. Optional (R7: list it as a follow-up rather than adding it to this diff): add a CHECK, or a db-check negative, that ties `line` prefixes or names to `statement`.

### Risks
- Fixture JSON that Ming commits is untrusted third-party content. gitleaks scans it, but nobody reviews it by hand. Low risk because it is used as test data only.
- `value bigint` arrives in JS as a number. Totals for the largest banks are around 2e15, still below 2^53, and the core safe-integer and `maxAbsTotalVnd` guards cover it. Re-check if the unit ever changes.
- The AI layer (STK-064/066) will read these rows. Under R9 the line labels and values are data, never prompt instructions, so keep them in a user-role or tool-result message in those tickets.

### Open questions
1. Is `fetchAll` (paging) or symbol chunking the preferred way to fix this repo? Default: `fetchAll` with an explicit order, to match `prices-daily.ts`.
2. Should the probe stop on 429? Default: yes, stop on any status other than 200 or 404.

## Attempt 2

## Security re-check: STK-061, attempt 2 (commit 86b5250)

**Verdict: the R4 integrity finding is fixed and the change adds no new security issues.** I read the code statically and did not run the tests or a live DB query.

### Findings
- 🟢 **R4 finding fixed.** `apps/worker/src/store.ts:88-94` now reads stored lines in symbol chunks of `linesSymbolChunk`, the same pattern the signals store uses at `:110-116`.
  - Each chunk is one query with the same `periodKind` and `fromPeriod`, and the results are concatenated.
  - The job's two reads at `apps/worker/src/jobs/financial-statements-sync.ts:107-108` both go through this wrapper.
- 🟢 **Chunk size fits under the cap.** `apps/worker/src/config.ts:105-106` sets `linesSymbolChunk: 4`.
  - Worst case is 4 symbols × 16 quarters × 12 lines = 768 rows, below the 1000-row PostgREST cap.
  - The real window is smaller: `lookbackQuarters` is 12, and `.gte('period', windowStart)` bounds the read. Years are 4 × 6 × 12 = 288 rows.
  - The 12-line count matches the registry (`packages/core/src/market/statement-lines.ts:23-36`).
- 🟢 **Wiring is correct.** `apps/worker/src/cli.ts:94` passes `c.linesSymbolChunk`. No new env vars, secrets, `NEXT_PUBLIC_*` or service-role exposure. Nothing changed under `apps/web`.
- 🟢 **Test covers the chunking.** `apps/worker/src/store.test.ts:37-45` checks the chunk boundaries (`[A,B],[C,D],[E]`), that the period arguments are passed through, and that results are concatenated.
- 🟡 **The cap bound is only a comment.** No test or runtime check ties `linesSymbolChunk × maxQuarters × lines` to the 1000-row cap (`config.ts:105`, `config.test.ts:22-29`).
  - The cash-flow slice (B) will add lines to `STATEMENT_LINES`. At about 16 or more lines, 4 × 16 × 16 = 1024 rows, and rows are silently dropped again. That brings back the false-gap bug.
  - `packages/db/src/repos/financial-lines.ts:19` still has no `order` and no check for truncation.
- 🟢 **Probe 🟡 from attempt 1 still open, as planned.** `scripts/probe-vci-iq-cashflow.sh` was not touched: it still writes non-200 bodies, has no stop on 429/5xx and no `--max-time`. Attempt 2 was scoped to the stored-lines read only, so this is a tracking item, not a regression.

### Recommendations
1. Add a test to `config.test.ts` (AC "missing recorded as gap", R4, R8):
   `expect(c.linesSymbolChunk * c.maxQuarters * Object.keys(STATEMENT_LINES).length).toBeLessThan(1000)`.
   When slice B adds lines, this fails CI instead of silently dropping rows. It is a one-line, low-risk addition. If R7 keeps it out of this diff, make it a `debt` issue linked to slice B.
2. Optional hardening (follow-up): make `listFinancialLines` throw when one response returns 1000 or more rows, so truncation is reported loudly and never turns into false gaps.
3. Confirm with the orchestrator that the attempt 1 probe-script recommendations are either in this ticket's plan or filed as a follow-up.

### Risks
- The protection against silent truncation depends on the line count staying small. Slice B is the trigger to watch.

### Open questions
- None blocking.
