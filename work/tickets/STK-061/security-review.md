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
