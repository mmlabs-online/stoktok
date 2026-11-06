## Attempt 1 — 2026-11-06

### Files touched
| File | Required because |
|---|---|
| supabase/migrations/20261106000100_lottery.sql | Both tables, checks, indexes, RLS, grants (AC 1-3). Status-shape branches use `is not null` guards, since a bare `gross_vnd > 0` passes on null. |
| supabase/rollback/20261106000100_lottery.down.sql | Rollback |
| scripts/db-check/checks.sql | tables_exist list, bigint/source columns, lottery_columns, service_role blocks, bad-row cases, lottery_duplicates |
| packages/core/src/lottery/canonical.ts, canonical.test.ts, index.ts | canonicalTicketLines + tests + export |
| packages/db/src/rows.ts, mappers.ts | Row types, draw/ticket mappers, drawId helpers |
| packages/db/src/repos/lottery.ts, lottery.test.ts | Repo functions + fake-client tests |
| packages/db/src/index.ts | Exports |

### Tests added / changed
- packages/core/src/lottery/canonical.test.ts (5 tests, as planned)
- packages/db/src/repos/lottery.test.ts (all planned tests, plus one: invalid draw id → VALIDATION on create)
- checks.sql: lottery_columns, service_role_can_read_write_lottery_draws/_tickets, 19 bad-row cases, lottery_duplicates

### Checks (actual output summary)
- typecheck: green (all workspaces)
- lint: green (after removing one unused import)
- test: green; core 657, db 143 (+1 todo), worker 229, web 300, sources 24
- db:check: ran locally (local Postgres 16), "db:check OK" including re-apply after rollback

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Ming to confirm channel `manual` (spec F8 lists only sms/momo) and update the spec line (plan A2).
- Callers (STK-054/055) must validate with core validateTicketLines/validateDrawResult before writing (A10).

### Scope self-check
- Could the diff be smaller? No.
- Diff size: about +900 lines including tests and SQL checks (new files uncommitted)
