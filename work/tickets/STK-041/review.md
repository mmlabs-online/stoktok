## Attempt 1 — 2026-11-01
Verdict: PASS

### Checks (run by reviewer)
- typecheck: green (packages/core, packages/db, apps/web, apps/worker all `Done`)
- lint: green (eslint, all four packages `Done`, no warnings)
- test: core 494/494, db 117 + 1 todo, worker 174/174, web 214/214; 0 failed. Matches impl-log.md.
- `git status` clean after the checks (apps/web/next-env.d.ts unchanged).

### Acceptance criteria
- [x] Out-of-window reject does not fail and is listed separately — evidence: `financials-sync.test.ts` › "run health (STK-041)" › "reject before windowStart: ok true, listed out-of-window" (BCG 2021Q2 in `rejectedOutOfWindowBySymbol`, `rejectedBySymbol: {}`) and "reject after windowEnd: ok true, no gap for 2026Q3"; core `quarters.test.ts` › `isPeriodInWindow` (both ends inclusive, both outside false, across a year boundary). Implementation `apps/worker/src/jobs/financials-sync.ts:140-142`.
- [x] `unsupported_company_type` does not fail; `unsupportedSymbols`; in-window gaps still recorded (R4), idempotent — evidence: "unsupported company type: ok true, listed, 12 gaps, idempotent, one log line" (`gapsRecorded: 12`, `missingPeriods.TCB` = 2023Q3..2026Q2, no rows, second run `gapsRecorded: 0`, `m.gaps` length 12). Gap code path is unchanged: `known` still includes every reject period (`financials-sync.ts`, gap block), so `planFinancialGaps` records all in-window quarters.
- [x] Other in-window rejects still fail — evidence: `test.each(['missing_shares','missing_eps'])` "in-window %s -> ok false"; "period-less reject is in-window and failing" (`invalid_row`, `ok: false`, `rejected: 1`); "unsupported plus a failing reject on the same symbol -> ok false"; existing "rejected period recorded as gap …" (`eps_out_of_band`, `rejected: 2`, `ok: false`) unchanged and green. A reject with no period always lands in the failing branch (`r.period !== undefined && …` guard, line 140). The reason match is exact: `readonly string[].includes(r.reason)` (line 134), no substring match.
- [x] Rule in one config constant + ADR — evidence: `apps/worker/src/config.ts:75-76` `nonFailingRejectReasons`; no `'unsupported_company_type'` literal in `financials-sync.ts` (grep empty); "reason list comes from config" test (empty list → `ok: false`, `rejected: 12`, `rejectedOutOfWindow: 4`); `config.test.ts` pins the default; ADR 0005 decision 8 + emitted-range sentence.
- [x] Unit tests with the in-memory store and fixtures; checks green — see Checks.
- [x] Replay of the 2026-11-01 dry-run gives `ok: true` — evidence: "replay 2026-11-01 dry-run shape › ok true": now 2026-11-01T11:28Z, dry run, `windowEnd: '2026Q2'`, `periodsFetched: 44`, `rejected: 0`, `rejectedOutOfWindow: 4`, `rejectedNonFailing: 112`, 7 sorted unsupported symbols. Fidelity vs ticket evidence: 112 + 4 = 116 = live `rejected`; 44 = live `periodsFetched` (BCG 6 + GAS 12 + 2×13); bank rejects 2022Q4..2026Q3 × 16 match the source's `unsupported_company_type` shape (`vci-iq-financials.ts:142-143`); BCG 2021Q2/2021Q4/2022Q1 and GAS 2026Q3 `missing_shares` match. The variant with one extra in-window GAS 2025Q4 `missing_shares` gives `ok: false`, `rejected: 1`.

### Issues
None.

### Scope
All changed code/doc files are in the plan's file list. `work/backlog.md`, `work/tickets/STK-041/*` and `work/tickets/STK-042/ticket.md` are workflow files from the ticket-creation and plan commits.

### Rules R1–R10
No violations found. R1/R2: no money math touched. R4: gaps for unsupported symbols are still recorded, tested, and idempotent. R5: reason list is config. R7: sources, `planFinancialGaps` and the `kept` filter are unchanged. R8: the new core predicate has unit tests. R6 is suspended. R3, R9 and R10 are not affected.

### Nits (do not block)
- `isPeriodInWindow` relies on lexicographic `comparePeriods`, so a malformed period string (e.g. `'garbage'`) would compare as "after windowEnd" and be classified out-of-window (silenced). This cannot happen today, because every reject period comes from `periodOf` / `normalizeQuarterlyFinancials`. A cheap hardening is to treat `parsePeriod(r.period) === null` as in-window/failing.
- Replay fixture: BCG omits its 7 valid pre-window quarters (2021Q1..2023Q2 minus the 3 rejects). It does not affect any asserted count, because `kept` drops them, but adding them would mirror the live 16-quarter range more literally.
- The `unsupported ${symbol}` log line prints only the first non-failing reason it sees for that symbol.

### Follow-ups (out of scope)
- A unit/validation failure (e.g. `eps_out_of_band`) on the newest quarter after `windowEnd` no longer fails the run, by AC1 design. Vendor unit drift often shows up first on the newest quarter. Consider failing for non-lag reasons after `windowEnd` (only `missing_shares` is the known ratio-lag case). This is Ming's call.
- README "Financials sync" section still describes TCBS / ADR 0002 (from STK-039, noted by the planner).
- BCG: no price bars, newest financials 2024Q4. Possible delisting; Ming to check.
