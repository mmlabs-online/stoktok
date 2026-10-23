## Attempt 1 — 2026-10-23
Verdict: PASS

### Checks (run by reviewer)
- typecheck: green (packages/core, apps/web, apps/worker: `tsc --noEmit` Done)
- lint: green (core, web, worker: `eslint .` Done)
- test: packages/core 6 files, 53 tests passed (matches impl-log)
- db:check: `db:check OK` (bootstrap → apply 000100, 000200 → checks → rollback 000200, 000100 → 0 tables → re-apply → checks)
- Reviewer mutation tests (scratch copy, repo untouched). Each one made db:check fail with the expected check:
  - `grant select … to anon` → `no_grants_anon_authenticated_public`
  - `disable row level security` → `rls_enabled_all_tables`
  - anon policy → `no_policies`
  - `fee numeric` → `no_numeric_or_float_columns`
  - nullable `prices_daily.fetched_at` → `source_fetched_at_not_null`
  - extra table → `tables_exist`
  - Exception: `grant update on all sequences … to anon` was **not** caught (see Follow-ups).
- Actual post-migration sequence ACLs: `{postgres=rwU, service_role=rwU}`, with no anon/authenticated entries.

### Acceptance criteria
- [x] Migrations create the 7 v1.0 tables. Evidence: `supabase/migrations/20261023000100_v1_tables.sql`; check `tables_exist` asserts the exact set (checks.sql:30-37). The mutation test confirms it.
- [x] Money columns are bigint, qty/price are integer, no numeric/float. Evidence: tables migration lines 9-10, 30-32, 48, 83, 85. Checks `no_numeric_or_float_columns`, `money_columns_bigint`, `qty_price_columns_integer`. The mutation test confirms it.
- [x] corporate_actions has ex/record/pay/listing dates, amount_per_share, ratio_num/den; transactions has a stable ordering key. Evidence: tables migration lines 22-41, `seq bigint generated always as identity unique` with index `(symbol, trade_date, seq)`. Checks `corporate_action_columns` and `transactions_seq_identity_unique`. Mapper test `stock: ratio_den->held, ratio_num->received (100:20)`.
- [x] prices_daily/data_gaps have `source`/`fetched_at` NOT NULL; settings has ppm rates and `cash_dividend_treatment`. Evidence: checks `source_fetched_at_not_null`, `settings_columns`, `qty_price_columns_integer` (ppm). Mapper test `maps ppm fields 1:1`.
- [x] RLS on every table, no policies, no anon/authenticated access, verified by a check. Evidence: `20261023000200_v1_rls_grants.sql`. Checks `rls_enabled_all_tables`, `no_policies`, `no_grants_anon_authenticated_public`, behavioural 42501 loop for anon/authenticated, `rls_blocks_even_with_grant`, `service_role_can_read_write`. Mutation tests confirm them.
- [x] Migrations apply cleanly from empty, and the check runs through a documented pnpm script. Evidence: `pnpm db:check` output above; `package.json` `db:check`; `supabase/README.md`.
- [x] Row ↔ core mappers with safe bigint, plus unit tests. Evidence: `packages/core/src/db/mappers.ts` (`toSafeInt` rejects unsafe/non-integer values) and `mappers.test.ts`. All tests listed in the plan are present and pass.

### Issues
None blocking.

### Scope
Every changed file is in the plan's file list. Workflow files changed: backlog.md and ticket.md (state → REVIEW), plus the consult, plan and impl-log files. No unjustified out-of-plan changes.

### Rules R1–R10
No violations found.
- R1/R2: mappers only convert, integers only.
- R3/R6: no policies; anon/authenticated revoked and tested behaviourally; there are no server entry points in this diff.
- R4: `source`/`fetched_at` are NOT NULL.
- R5: no market values in SQL; settings has no seed row, and defaults stay in core `DEFAULT_MARKET_SETTINGS`.
- R7: diff stays within the plan.
- R8: green, and the new core logic has tests.
- R10: no brokerage tables.
- The spec divergence (no `lots` table, `applied` dropped) is flagged in plan.md and supabase/README.md, as the ticket asked.

### Nits (do not block)
- `scripts/db-check.sh:19-25`: the localhost guard parses only the URL authority. A libpq query parameter (`postgresql://localhost/db?host=remote`) would bypass it. You could also reject URLs that contain `host=`/`hostaddr=`.
- `packages/core/src/db/mappers.ts` `settingsFromRow`: `holidays` is passed through without per-element validation or copying. node-postgres parses `date[]` (OID 1182) to `Date[]` by default. `buildLedger` does reject invalid holidays (build-ledger.ts:55-56), so the failure is loud, not silent. Still, validating here with `toDate` would give the same driver-misconfig message as the scalar dates.
- `checks.sql` `transactions_seq_identity_unique`: if `ident` is NULL (column missing), `ident <> 'YES'` is NULL and the check would not raise. In practice `money_columns_bigint` runs first and catches a missing column.

### Follow-ups (out of scope)
- `no_grants_anon_authenticated_public` checks only sequence USAGE (`role_usage_grants`). SELECT/UPDATE grants on sequences to anon go undetected (confirmed by mutation). The current migration revokes all, so the current state is correct. Strengthen the check with `aclexplode(relacl)` over `relkind = 'S'`, and also assert `pg_default_acl` has no anon/authenticated entries for schema public.
- Add `pnpm db:check` to CI once a workflow exists (impl-log already notes this).
- Ming to confirm the spec divergence: no `lots` table, no `corporate_actions.applied`, `tax_rate` → `sell_tax_rate_ppm`.
- Ming to confirm the plan assumptions: one `prices_daily` row per (symbol, date); `foreign_net` = signed VND; no settings seed row.
