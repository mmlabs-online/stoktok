# Security review — STK-053

## Attempt 1 — 2026-11-06

## STK-053 security review, attempt 1. Verdict: no blocking issues

I reviewed:
- /home/user/stoktok/supabase/migrations/20261106000100_lottery.sql
- /home/user/stoktok/supabase/rollback/20261106000100_lottery.down.sql
- /home/user/stoktok/scripts/db-check/checks.sql (the lottery blocks)
- /home/user/stoktok/packages/db/src/repos/lottery.ts
- /home/user/stoktok/packages/db/src/mappers.ts (lottery mappers)
- /home/user/stoktok/packages/db/src/index.ts

I had no shell, so I read the files directly instead of running `git diff`. I did not run `db-check` or the tests.

### Findings

🟢 **RLS and grants match the existing pattern.** Migration lines 74–80:
- RLS is enabled on both tables.
- No policies are created.
- `revoke all … from public, anon, authenticated` matches the newer form in `20261105000200_prices_intraday.sql:19`.
- `service_role` gets only select, insert, update and delete.
- The tickets id is `gen_random_uuid()` (`:36`), so there is no new sequence to revoke.
- The existing global checks in `checks.sql:161-195` (`rls_enabled_all_tables`, `no_policies`, `no_grants_anon_authenticated_public`, `anon_denied`/`authenticated_denied`) now also cover both lottery tables. The expected table list is updated at `checks.sql:34`.

🟢 **No new service-role exposure (R3).**
- `lottery.ts` takes an injected `Db` and never reads env.
- The new exports in `index.ts:60-69` reach the web app only through `apps/web/server/db.ts`, which starts with `import 'server-only'`.
- The existing `packages/db/src/r3-guard.test.ts` still enforces this: no `'use client'` file may import `@stoktok/db`, and the service key may only appear in `client.ts`.
- No `NEXT_PUBLIC_*` keys or hardcoded secrets were added.

🟢 **No SQL injection sink.**
- Every query goes through PostgREST builder calls (`.eq`, `.insert`, `.update`, `.upsert`), which send values as parameters.
- `drawId` must match `^\d+$` before use (`mappers.ts:191-195`).
- The `input()` wrapper (`lottery.ts:15-22`) shows only `e.field` to callers, so the raw draw id is not echoed back.

🟢 **`raw_text` storage is acceptable.**
- It is length-bounded, 1–2000 characters (`migration:49`), and stored verbatim.
- Duplicates are caught by a whitespace-normalised md5 unique index (`:64-66`).
- The `lines` size is capped: at most 50 lines and `pg_column_size` ≤ 8192 (`:40`).
- There is no LLM or HTML sink in this diff. React escapes text by default, so rendering is safe unless someone later uses `dangerouslySetInnerHTML`.

🟢 **Constraints are sound.**
- Draws have composite primary key `(game, draw_no)`, so a duplicate draw fails with 23505 (tested at `checks.sql:434`).
- The status/tier/gross state machine (`:51-55`) means a ticket cannot be "won" without a prize amount and check time.
- Money columns are `bigint` (R2).
- `source` and `fetched_at` are NOT NULL, and an empty `source` is rejected (R4).
- `updateLotteryTicket` (`lottery.ts:56-70`) resets the result columns, so a stale win cannot survive an edit.

🟡 **The `requireUser()` acceptance criterion is not testable in this diff.**
- Ticket AC line 22 says "Server data functions call `requireUser()`".
- `lottery.ts:1` only has a comment saying callers must call it. That is consistent with the existing repos and with plan.md:15/220, which moves the web handlers to STK-055.
- Nothing in `apps/web` calls the lottery functions yet, so there is no exposure today.
- The reviewer should record this AC as deferred to STK-055 rather than met. STK-055 must add `apps/web/server/lottery/handlers.ts` and register its entry points in `apps/web/test/entrypoints.test.ts`.

🟡 **A whitespace-only `raw_text` passes the column check.**
- `char_length(raw_text) between 1 and 2000` (`migration:49`) accepts `'   '`.
- The dedupe index then normalises it to `''`, so a second whitespace-only paste fails with a confusing CONFLICT.
- Fix: change the check to `char_length(btrim(raw_text)) >= 1`, or have the mapper/parser convert blank text to `null`. This can go to the follow-up list for STK-056 if it is outside this plan (R7).

🟢 **Large draw ids give the wrong error code.**
- `drawNoFromId` accepts any safe integer, but `draw_no` is `integer` (int4). A value above 2147483647 fails in Postgres with 22003, which `errors.ts:32-37` does not map to VALIDATION.
- Not exploitable. Follow-up: add an upper bound of 2^31−1 in `drawNoFromId`.

🟢 **`listLotteryTickets` has no row limit** (`lottery.ts:33-47`). This is fine for one user. Follow-up: add paging when the screen is built (STK-055).

🟢 **The rollback is complete.** It drops both tables, which also drops their indexes and grants.

### Recommendations
1. Mark the AC "RLS on, matching existing tables" as met. Evidence: migration `:74-80` plus the global checks in `checks.sql:161-195`.
2. Mark the `requireUser()` AC as deferred to STK-055 (R6, R7). Do not count it as met.
3. Put the whitespace-only `raw_text` fix on the follow-up list, or fold it into STK-056 (the SMS parser).

### Risks
- **Future prompt injection (R9, CWE-1426 / OWASP LLM01).** `raw_text` is user-pasted SMS text and should be treated as untrusted. If a later AI feature (v1.2+) reads ticket rows, `raw_text` must go only into a user-role message, never into a system prompt, and never on a call that has tools. Better still, pass only the parsed structured fields.
- **Personal data.** `raw_text` may contain phone numbers or transaction references. Given the tables are service-role only, this is acceptable for v1, which has a single allowlisted user.

### Open questions
- Should `momo` pastes also get the `(game, draw_no, purchased_at, lines)` identity dedupe? Today it applies only to `channel='sms'` (`migration:68-70`). `raw_text` dedupe still covers MoMo pastes that include text.
