## Security review: STK-014, attempt 1

**Verdict:** I found no 🔴. There are two 🟡 that I'd fix before or soon after PASS, and a few 💭. I did a static read only. I had no shell, so I read the changed files directly rather than running `git diff`.

### Findings

**🟡 1. The sector label has no charset filter, so one bad response can crash the write phase.** `packages/core/src/market/financials.ts:83-87`
- `normalizeSectorLabel` trims, collapses whitespace and caps length at 100. It lets through other control characters: NUL, ESC, bidi overrides (U+202E) and zero-width characters.
- Postgres `text` rejects NUL (pg 22P05 / 22021). If that happens, `setSymbolSector` throws inside the write loop at `apps/worker/src/jobs/financials-sync.ts:180-182`, after the financials upsert. The remaining sectors, `insertGaps` and `resolveGaps` never run. The `cli.ts:72` catch then exits 1. Gaps for that run are lost, which breaks AC3/R4 "missing periods are recorded".
- The other characters reach the DB and the UI as spoofable text. React escapes them, so this is not XSS.
- Fix: return null when the label matches `/[\p{Cc}\p{Cf}]/u`, after the whitespace collapse. Add a core test for NUL, ESC and U+202E. Optionally add `sector !~ '[[:cntrl:]]'` to `symbols_sector_format`.

**🟡 2. There is no response byte cap.** `apps/worker/src/sources/http.ts:28`
- `res.json()` buffers the whole body. `maxPeriodsPerResponse` (`tcbs-financials.ts:92`) only caps the array length after parsing. The 15 s timeout is the only real bound.
- The risk is low with a single-user worker and a fixed host. Still, the brief asked for a size cap and this is not one.
- Fix: reject on `content-length` above the limit, or read the stream with a byte limit (e.g. 2 MB) before parsing.
- `http.ts` is shared with STK-005 and isn't in the plan, so per R7 this goes to follow-ups. It can join the `redirect: 'error'` `/solo` the plan already lists.

**💭 3. Periods after `windowEnd` are stored.** `financials-sync.ts:118`
- The filter only checks `>= windowStart`. A source row labelled up to 2100Q4 passes `periodOf` and gets upserted.
- This is data integrity, not access control. Suggest also requiring `comparePeriods(p.period, windowEnd) <= 0`, or rejecting with reason `future_period`.

**💭 4. Redirects are followed and the no-network guard is shallow.**
- Redirects: `fetch` defaults to `redirect: 'follow'`, so the fixed host is not enforced across redirects. Only User-Agent and Accept are sent, so nothing leaks.
- Guard: `apps/worker/test/no-network.ts` only stubs global `fetch`. A direct `node:https` or `undici` call would get past it.
- Both are already in the plan's follow-ups (`plan.md:308`, `:356`). No change needed now.

**💭 5. The DB has no backstop checks on `financials`.** `supabase/migrations/20261026000100_financials.sql:7-11`
- `eps`, `bvps` and `net_income` have no range checks, and `source` has no non-empty check. Core enforces both.
- Optional: add `check (length(source) between 1 and 64)`.

### What checks out
- **Migration:**
  - RLS is enabled.
  - `revoke all … from anon, authenticated` plus a grant to `service_role` only (`:22-24`), with no policies.
  - Symbol and period regex checks, `revenue >= 0`, all money columns `bigint` (R2).
  - Sector format and provenance constraints are correct (`:30-33`).
  - The rollback is clean and symmetric.
- **checks.sql:**
  - `financials` is in `tables_exist`, so the loop-based checks cover it automatically: RLS on all tables, no policies, no anon/authenticated/PUBLIC grants, and anon/authenticated denied select and insert.
  - New tests: service_role read/write, bad-row checks (negative revenue, nulls, duplicate period), and the sector empty/untrimmed/provenance cases (`:96-128`, `:208-218`, `:247-260`).
- **Service role key (R3):**
  - Read only in `createServiceClient(process.env)` (`cli.ts:30`).
  - `TcbsFinancialsSource` gets no db or env (`cli.ts:34-40`).
  - `DataError` messages carry only table, op and pg code (`packages/db/src/errors.ts:10-20`).
  - Logged errors are fixed `SourceError` strings.
  - The summary JSON contains no credentials.
- **Outbound requests:**
  - Fixed base URL (`config.ts:17`).
  - URLs are built only from symbols that passed `normalizeSymbol` (`^[A-Z0-9]{3,10}$`), plus `encodeURIComponent` (`tcbs-financials.ts:37-41,58,123`).
  - 15 s timeout, 3 attempts with exponential backoff, retries only on network errors, 429 and 5xx.
  - Honest User-Agent (`config.ts:19`), 1 s delays, and the run stops after 5 consecutive failures.
- **Validation:**
  - The body must be an array, capped at 200 rows.
  - Rows with a mismatched ticker are dropped, and duplicated periods are dropped and reported.
  - `periodOf` requires integer year 1990..2100 and quarter 1..4.
  - `toVndAmount` requires a finite number, rounds, and checks for a safe integer.
  - Sanity bands are applied. All four values must be valid or the whole period is rejected (`financials.ts:34-78`).
- **Upsert payloads use known columns only:**
  - Financials rows are built field by field (`financials-sync.ts:133-142`).
  - `setSymbolSector` writes only `symbol`, `sector`, `sector_source`, `sector_fetched_at` and `updated_at`, never `exchange` (`symbols.ts:36-39`).
  - Data-gap inserts use explicit fields (`financials-sync.ts:160`).
  - `resolveGaps` updates only `resolved_at`.
- **Secrets in the repo:** I found none in the fixtures, `apps/worker/README.md` (it names the env keys, no values) or the ADR. `dist/` and `.env*` are git-ignored.

### Recommendations
- Fix 🟡1 in this ticket. It sits on AC3/R4 (gap recording must survive bad input) and the brief's "sector text length/charset" check. It's one core function plus a test.
- Add 🟡2 to the existing http-hardening follow-up (R7).
- 💭3 is a small addition to AC3 if the planner agrees.

### Risks
- The fixtures are synthetic. The real TCBS response shape and units are unverified (the ADR already notes this). The unit guards reject a wrong-unit period rather than store it, which is the right failure mode.

### Open questions
- None blocking.

Files reviewed:
- /home/user/stoktok/supabase/migrations/20261026000100_financials.sql
- /home/user/stoktok/supabase/rollback/20261026000100_financials.down.sql
- /home/user/stoktok/scripts/db-check/checks.sql
- /home/user/stoktok/packages/core/src/market/financials.ts
- /home/user/stoktok/packages/core/src/market/quarters.ts
- /home/user/stoktok/packages/db/src/repos/financials.ts
- /home/user/stoktok/packages/db/src/repos/data-gaps.ts
- /home/user/stoktok/packages/db/src/repos/symbols.ts
- /home/user/stoktok/apps/worker/src/sources/tcbs-financials.ts
- /home/user/stoktok/apps/worker/src/sources/http.ts
- /home/user/stoktok/apps/worker/src/jobs/financials-sync.ts
- /home/user/stoktok/apps/worker/src/cli.ts
- /home/user/stoktok/apps/worker/src/config.ts
- /home/user/stoktok/apps/worker/test/no-network.ts
