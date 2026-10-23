## Attempt 1 — 2026-10-23

### Files touched
| File | Required because |
|---|---|
| `supabase/migrations/20261023000100_v1_tables.sql` | AC1–4: the 7 tables, constraints, indexes |
| `supabase/migrations/20261023000200_v1_rls_grants.sql` | AC5: RLS, revokes, service_role grants, default privileges |
| `supabase/rollback/20261023000100_v1_tables.down.sql` | AC6: reversible tables |
| `supabase/rollback/20261023000200_v1_rls_grants.down.sql` | AC6: intentional no-op |
| `supabase/.gitkeep` (deleted) | Directory now non-empty |
| `supabase/README.md` | AC6: documentation, no-`lots` note |
| `scripts/db-check.sh` | AC6: runner (throwaway Postgres, root via runuser, DB_CHECK_URL localhost-only) |
| `scripts/db-check/bootstrap-roles.sql` | Test-only roles and Supabase-like default grants |
| `scripts/db-check/checks.sql` | AC1–5 assertions, run in a rolled-back transaction |
| `package.json` | `db:check` script |
| `packages/core/src/db/rows.ts` | AC7: row types |
| `packages/core/src/db/mappers.ts` | AC7: mappers, `toSafeInt`, `RowMappingError` |
| `packages/core/src/db/mappers.test.ts` | AC7: unit tests |
| `packages/core/src/index.ts` | Export mappers and row types |

### Tests added / changed
- `packages/core/src/db/mappers.test.ts`: all tests listed in the plan (toSafeInt, transaction, corporate action, settings, round trips).
- `scripts/db-check/checks.sql`: all named checks in the plan. Mutation-checked: adding `grant select ... to anon` and switching to `disable row level security` each made db:check fail with the expected CHECK FAILED.

### Checks (actual output summary)
- typecheck: green (core, web, worker)
- lint: green (core, web, worker)
- test: core 6 files, 53 tests passed
- db:check: `db:check OK` (apply, checks, rollback to 0 tables, re-apply, checks)

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Add `pnpm db:check` to CI once a workflow exists.
- `settingsFromRow` ignores `rule_configs` / `concentration_threshold_ppm`; a later ticket gives them a typed shape.
- Exchange metadata (no `exchange` column yet).

### Scope self-check
- Could the diff be smaller? No.
- Diff size: about +900 lines (SQL checks and tests are the bulk), -0.
