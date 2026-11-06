## Attempt 1 — 2026-11-06
Verdict: PASS

Reviewed commit `2a6640f` ("STK-053: Vietlott schema and data layer (attempt 1)"), `git diff HEAD~1..HEAD`.

### Checks (run by reviewer)
- typecheck: green (`pnpm typecheck` exit 0, all workspaces)
- lint: green (`pnpm lint` exit 0, all workspaces)
- test: green. Counts: core 51 files / 657 tests, sources 24, db 16 files / 143 (+1 todo), worker 229, web 300. These match impl-log exactly.
- db:check: green against local Postgres. All migrations including `20261106000100_lottery.sql` applied, rollback and re-apply worked, and the run printed `db:check OK`.

### Acceptance criteria
- [x] AC1 Tables and columns: `supabase/migrations/20261106000100_lottery.sql:5-30` (draws: game, draw_no, draw_date, numbers, bonus, jackpot_*/jackpot2_*, source, fetched_at) and `:35-56` (tickets: game, draw_no, lines, cost_vnd, channel sms/momo/manual, purchased_at, status, prize_tier, gross_vnd, raw_text). System size is the length of each line, per plan A5. db:check covers `tables_exist`, `money_columns_bigint`, `source_fetched_at_not_null`, `lottery_columns` and the two `service_role_can_read_write_lottery_*` blocks. The rollback file exists.
- [x] AC2 RLS / R3: migration `:73-79` enables RLS, revokes from public/anon/authenticated and grants only to service_role, with no policies. The generic db:check loops (`rls_enabled_all_tables`, `no_policies`, `anon_denied`/`authenticated_denied`) passed. `r3-guard.test.ts` is green.
- [x] AC3 Unique keys / duplicate detection: PK `(game, draw_no)`; `lottery_tickets_raw_text_uidx` normalises whitespace with md5; `lottery_tickets_sms_identity_uidx` is partial on `channel = 'sms'`. In checks.sql, the `lottery_duplicates` block shows a duplicate draw → 23505, raw text with different whitespace → 23505, a repeated SMS identity → 23505, and two manual rows with the same identity → OK. In vitest, `lottery.test.ts › createLotteryTicket canonicalises lines before insert` and `› maps 23505 to CONFLICT` pass. Lines are canonicalised by core `canonicalTicketLines` with 5 unit tests.
- [x] AC4 requireUser / tests: the repo header at `packages/db/src/repos/lottery.ts:1` follows the existing convention ("Callers must call requireUser() first"), per plan A1. No web entry point is added, and `entrypoints.test.ts` is green. Every planned fake-client test exists and passes, plus one extra (invalid draw id → VALIDATION).
- [x] AC5 typecheck, lint, test green: see above, plus db:check.

### Scope
The changed files match the plan's file list exactly, plus the workflow state edits to `ticket.md` and `backlog.md`. No `apps/web` or `apps/worker` changes. No out-of-plan files.

### Issues
None.

### Rules R1–R10
No violations.
- R1: the repo stores values that callers pass in and does no prize or tax maths.
- R2: money columns are bigint, and the mappers use `toSafeInt`.
- R3: grants go to service_role only.
- R4: draw `source`/`fetched_at` are NOT NULL, and `lotteryDrawFromRow` rejects a row without them.
- R5: SQL has only loose structural bounds; game rules stay in core.
- R8: the core function has tests.
- R10: tickets are recorded only.

### Nits (do not block)
- `packages/db/src/mappers.ts` `lotteryDrawFromRow`, `pool(...)`: winner counts are passed to `toSafeInt` with the column label `jackpot_vnd`/`jackpot2_vnd`, so a mapping error names the wrong column.
- `lotteryDrawFromRow` calls `row.numbers.map` without an `Array.isArray` guard. A malformed row would throw `TypeError` instead of MAPPING. The DB enforces NOT NULL, so this is low risk.
- `recordLotteryTicketResult` with `status: 'lost'` silently drops any `grossVnd` the caller passes. That is fine, but it could be documented.

### Follow-ups (out of scope)
- STK-054: `recordLotteryTicketResult` updates by `id` only. If the user edits a ticket while the checking job runs, the job can write a result computed from the old lines. Consider adding `.eq('status','pending')` and/or matching `draw_no` in the update, and treating NOT_FOUND as "skipped".
- `listLotteryTickets` is not paged (PostgREST caps responses at max_rows). Use `fetchAll` if ticket history ever exceeds ~1000 rows.
- Plan A2: Ming should confirm the `manual` channel and update spec F8, which lists only sms/momo.
