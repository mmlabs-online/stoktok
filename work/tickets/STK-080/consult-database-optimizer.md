STK-080 DB consult (read-only). Nothing edited.

## Findings

**1. Migrations on plain Postgres: what is Supabase-specific**
- Only three kinds of Supabase coupling exist; the table DDL itself is plain PG. `gen_random_uuid()` is in core since PG13, so no extension is needed (supabase/migrations/20261023000100_v1_tables.sql:5,26,48; 20261106000100_lottery.sql:36).
- (a) Role grants. Every table migration has `revoke ... from anon, authenticated` plus `grant ... to service_role`. These fail with `role "anon" does not exist` on plain PG.
  - 20261023000200_v1_rls_grants.sql:3-19, which also sets the default privileges (:17-19).
  - 20261025000100_symbols.sql:14-15
  - 20261026000100_financials.sql:23-24
  - 20261026000200_signals.sql:40-43
  - 20261105000200_prices_intraday.sql:19-20
  - 20261106000100_lottery.sql:75-80
  - 20261108000100_financial_lines.sql:27-28
  - 20261108000200_news.sql:31-32
  - 20261109000100_ai_usage.sql:29-31 and :90-93
  - 20261110000100_ai_reserve_harden.sql:50-51
  - 20261110000200_ai_keys.sql:22-24 and :110-115
  - 20261110000300_ai_summaries.sql:42-44
- (b) `alter table ... enable row level security` on every table. The same files carry it, plus 20261023000200:8.
- (c) Vault. `20261110000200_ai_keys.sql:6-11` raises unless `vault.secrets` exists. The body uses `vault.create_secret`, `vault.update_secret` and `vault.decrypted_secrets` (:52-58, :90, :107). The rollback also touches vault (rollback/20261110000200_ai_keys.down.sql:8-14).
- Existing rollbacks are mostly fine. `rollback/20261023000200_v1_rls_grants.down.sql` is a no-op, which is OK.
- The migration runner is only `psql --single-transaction -f` in name order (scripts/db-check.sh:47-49). There is no tracking table, so nothing is Supabase-CLI-specific. The folder name `supabase/` only matters for docs and CI paths.

**2. Sequences and identity**
- Identity columns are `transactions.seq` (v1_tables.sql:6), `data_gaps.id` (:96), `signals.id` (signals.sql:5), `news.id` (news.sql:5), `ai_usage.id` (ai_usage.sql:5) and `ai_summaries.id` (ai_summaries.sql:6).
- They are all `generated always as identity`. A plain `COPY` or `INSERT` of explicit values fails unless you use `OVERRIDING SYSTEM VALUE`. `pg_dump --data-only` emits COPY, which is allowed for GENERATED ALWAYS. It does not emit INSERT-with-override unless `--inserts` is used, so avoid `--inserts` for these tables.
- The sequences must be advanced after the load. `pg_dump` includes `setval`, but only for sequences in the dump. Check them explicitly afterwards.
- `transactions.seq` drives tie-break ordering (transactions.ts:26, index at v1_tables.sql:23). Preserve the values, and verify the sequence is at or above `max(seq)`.

**3. SECURITY DEFINER and ai_* functions**
- `ai_reserve` and `ai_month_spend` are already `security invoker` with `search_path=''` (ai_usage.sql:45,83; harden.sql:14-15). They need no role change, only the grant swap to the app role.
- `ai_reserve` uses `pg_advisory_xact_lock(hashtext('stoktok.ai_budget'))` (ai_usage.sql:58, harden.sql:29). Advisory locks are database-scoped, so with one app database this is unchanged.
  - Caution: if web and worker use PgBouncer in transaction mode, xact-level locks are still fine. Session-level locks would not be.
  - The function must run in one transaction, which it does as a single statement. It uses `now()` and not `clock_timestamp()` for the window check (harden.sql:25). The `now()` window check is evaluated at transaction start. That is fine for a single-statement call but breaks if the app wraps it in a long transaction.
- `ai_key_set`, `ai_key_delete` and `ai_key_secrets` are the only three SECURITY DEFINER functions (ai_keys.sql:28-108). The justification at :27 is Vault privileges, which disappears on plain PG. Replace them as follows.
  - Drop the DEFINER functions and the `vault` dependency.
  - Store `secret_ct bytea` (or `text`) in `ai_keys`, encrypted in the app (AES-256-GCM, master key from server-only env) or with `pgcrypto` `pgp_sym_encrypt`.
  - Prefer app-side encryption. With pgcrypto, the master key travels in SQL text and can leak via `pg_stat_statements` and the server log (`log_statement`, `log_min_duration_statement`). App-side also keeps the key off the DB host and out of pgAdmin sessions.
  - Plain SQL upsert: `insert ... on conflict (provider) do update set secret_ct=excluded.secret_ct, last4=excluded.last4, updated_at=now()`. The advisory lock and the orphan handling (:49-59) become unnecessary, since there is no second store to reconcile.
  - `secret_id uuid unique` (:15) and the vault orphan logic (:49-59) go away. Keep the `last4` check (:16) and the 20-256 printable-ASCII check, which duplicates `validateAiKeyFormat` in packages/core.
  - Keep the "single write path" idea if you want. Either keep a tiny non-DEFINER function, or grant the app role `select` on `ai_keys` with write by plain INSERT/UPDATE.
  - Do not log SQL parameters. The db:check negative that the error does not echo the key (checks.sql:790-796) should move to a unit test on the repo layer.
  - If DEFINER is kept for any reason, the checks at checks.sql:803-832 (search_path empty, no PUBLIC execute, allowlist) must still hold. Otherwise empty the allowlist at :829 to `array[]::text[]`.
- Edit policy: migrations 20261110000200 and the earlier ones are merged. Prefer a new forward migration, e.g. `…_plain_pg.sql`, that drops the Vault-based functions and recreates `ai_keys`. Do not edit old files, or the db:check re-apply contract and any already-deployed DB diverge. However, the old `ai_keys.sql` raises without Vault, so on plain PG it cannot run at all. This forces a squash/baseline decision (see Recommendations 1).

**4. Roles and RLS replacement**
- RLS plays no real role here: there are no policies (checks.sql:194-199) and the only client is service_role, which has BYPASSRLS. RLS is purely a lockout for anon/authenticated. With no such roles and no PostgREST, it adds nothing except a footgun. If the app role is not the table owner and has no BYPASSRLS, RLS-enabled tables with zero policies would deny it all rows. So if RLS stays, you must either add permissive policies or give the app role BYPASSRLS, which defeats the point.
- Recommended model, two roles.
  - `stoktok_owner` (NOLOGIN or migration-only login) owns the schema objects and runs migrations.
  - `stoktok_app` (LOGIN, `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`) has `USAGE` on `public` and `SELECT/INSERT/UPDATE/DELETE` on the tables, plus `USAGE, SELECT` on sequences and `EXECUTE` on the two `ai_*` budget functions. It has no DDL, no `TRUNCATE`, no `REFERENCES`/`TRIGGER`.
  - Where per-table tightening is cheap it is worth doing. For example `ai_keys` could be limited to select/insert/update/delete only if app-side encryption is used; the old "select only" trick (ai_keys.sql:24) was tied to DEFINER writes.
  - Optional: separate `stoktok_worker` and `stoktok_web` logins with the same grants, so pg_stat_activity and connection caps are attributable per process. This is cheap and gives separate pool limits.
- Migrations must not hard-code role names where the name varies per environment. Options: (i) a psql variable (`\set app_role stoktok_app`) and `format()` in a DO block; (ii) a fixed role name created once by a bootstrap script outside the migration chain (like `scripts/db-check/bootstrap-roles.sql`, which today is "TEST ONLY", :1). With a fixed name, migrations simply `grant ... to stoktok_app`. That requires the role to exist before migrations. Document this as a one-time pgAdmin/psql step in the runbook.
- Default privileges are the cleanest mechanism: `alter default privileges for role stoktok_owner in schema public grant select,insert,update,delete on tables to stoktok_app; ... grant usage,select on sequences ...; ... grant execute on functions ...`. Then later migrations need no per-table grants and the 12 files above can be reduced to one. The current per-file grants exist because the loop in 20261023000200 only covered tables that existed then (see the comment at ai_usage.sql:2).
- Also `revoke all on schema public from public` and `revoke create on schema public from public` (PG15+ already revokes CREATE by default; PG14 and older do not). Check the version Ming runs.
- Also `revoke all on database <db> from public` and `revoke execute on all functions in schema public from public`. By default PG grants EXECUTE on new functions to PUBLIC. The existing migrations `revoke ... from public` per function (ai_usage.sql:90,92); keep that or set `alter default privileges ... revoke execute on functions from public`.
- Grant-minimal sequences: only `usage, select`, not `update`. This is enough for `nextval` via identity inserts.
- Connection: `scram-sha-256` in pg_hba, TLS if the DB is not on the Docker network or loopback, and listen only on the compose-internal network or a LAN address. Do not publish 5432 through the Cloudflare Tunnel.

**5. db:check changes (scripts/db-check.sh and scripts/db-check/checks.sql)**
- scripts/db-check.sh:53 runs `bootstrap-roles.sql`. Replace it with a bootstrap that creates `stoktok_owner` and `stoktok_app` (and optionally a stub role that mimics a fresh DB with default PUBLIC grants). Delete the Vault stub (bootstrap-roles.sql:13-52).
- Run the migrations as `stoktok_owner` so default privileges apply, and run the role-based checks as `stoktok_app`. Today everything runs as superuser `postgres` and role checks use `set local role` (checks.sql:217, 245, etc.). `SET ROLE` as a superuser still works but hides missing privileges only if the role switch is skipped, so keep it.
- Mechanically replace `set local role service_role` with `set local role stoktok_app` in the 14 `service_role_can_read_write_*` checks and the ai_reserve gate:
  - checks.sql:245, 255, 266, 278, 290, 302, 319, 344, 359, 519, 564, 641 (and :727, :747, :760, :765, :778 for the ai_key checks).
  - Rename the labels too ("service_role_..." to "app_role_...").
- Delete or rewrite:
  - `rls_enabled_all_tables` (:186-192) and `no_policies` (:194-199). If RLS is dropped, delete them. If RLS is kept as defense-in-depth, keep them and give the app role BYPASSRLS... not recommended, see §4.
  - `no_grants_anon_authenticated_public` (:201-210). Replace with: no grants to PUBLIC, and `stoktok_app` has exactly the intended privileges. Note the `information_schema.role_table_grants` query only sees grants for roles the current user is a member of or owns, so run it as a superuser or use `pg_class.relacl` with `aclexplode` for reliability.
  - `anon_denied/authenticated_denied` (:212-223) and `rls_blocks_even_with_grant` (:225-240). Replace with a check that a third unprivileged role (`stoktok_nobody`, created in bootstrap) cannot select/insert on any table, and that `stoktok_app` cannot `create table`, `drop table`, `truncate`, or `alter`.
  - `ai_functions_locked` (:675-693). It asserts `proconfig` has `search_path=""` and not DEFINER. Keep the invoker/search_path part, change the role names, and add "PUBLIC cannot execute" via `aclexplode`. The existing line :679 only checks anon/authenticated.
  - `ai_keys_columns` (:695-701): drop the `secret_id uuid` assertion; assert the new ciphertext column.
  - `ai_keys_privileges` (:703-716): rewrite for the new model.
  - `ai_key_roundtrip`, `ai_key_negatives` (:718-801): delete the vault-row assertions (:744-770, :798). If crypto is app-side there is nothing to test in SQL except constraints on `last4`/length and upsert behaviour. Add a TS unit test for encrypt/decrypt and no-leak-in-error.
  - `ai_key_functions_locked` (:803-822), `security_definer_allowlist` (:824-832) and `ai_key_vault_direct_denied` (:834-846): delete, or make the allowlist empty.
- Rollback phase (scripts/db-check.sh:58-60) counts remaining tables in `public`. Also assert that no functions, sequences or types remain in `public` (`pg_proc`, `pg_class` for relkind S, `pg_type`), and that the app role still exists. The rollback leaves roles alone, and bootstrap is idempotent, which matters because `bootstrap-roles.sql` is run only once at :53, before the re-apply at :62.
- Rollbacks need review. With default privileges, "drop table" removes grants. With the app role created outside migrations, the rollback chain does not drop roles, which keeps re-apply idempotent. Rewrite `rollback/20261110000200_ai_keys.down.sql` to drop the table and functions only, with no vault references (:8-14).
- Make the harness independent of the local binaries: it already supports `DB_CHECK_URL` for localhost only (scripts/db-check.sh:19-25). The credential for the owner role then needs to come from the URL. CI (.github/workflows/ci.yml:48) can keep using the throwaway server. Consider a second CI matrix run on the PG version Ming actually runs (check `select version()` on his instance); the harness is pinned to 16 via `PG_BIN` default (:27).
- Rename `supabase/` to `db/` or `migrations/`? That touches db-check.sh:49-50, supabase/README.md and ci. It is cosmetic; defer to a follow-up unless the planner wants it in this ticket (R7).

**6. Repo upserts: PostgREST to SQL (packages/db/src/repos)**

| Repo call | Conflict target | SQL |
|---|---|---|
| symbols.ts:25, :36-38 | `symbol` | `insert ... on conflict (symbol) do update set exchange=excluded.exchange, updated_at=excluded.updated_at`. Check what columns the second call updates; it may update only sector fields, so do not overwrite exchange unintentionally. |
| prices-intraday.ts:46 | `symbol,ts` | `on conflict (symbol,ts) do update set price,volume,source,fetched_at = excluded.*` (exact set matches checks.sql:325) |
| prices-daily.ts:140 | `symbol,trade_date` | `on conflict (symbol,trade_date) do update` over all non-key columns |
| financials.ts:35 | `symbol,period` | same pattern |
| financial-lines.ts:40 | `symbol,period_kind,period,line` | same. Note the table's unique key may also include `statement`; verify against 20261108000100 before copying. |
| signals.ts:53 | `symbol,rule_id,horizon,signal_date` | `on conflict (...) do update set` all non-key columns (checks.sql:309 updates only label/value in the test, but the repo upserts the full row) |
| lottery.ts:119 | `game,draw_no` | same |
| ai-summaries.ts:16 | `scope,symbol,summary_date` | `on conflict (...) do update set generator, provider, model, usage_id, body_version, body, input_ids, created_at=now()`. Note the column comment says `created_at` is "refreshed on replace" (ai_summaries.sql:39) but the db:check test only sets generator/provider/model/body (checks.sql:626-627). PostgREST upsert sends `created_at` only if the row has it; verify the repo's row builder. Do not rely on the default, since `ON CONFLICT DO UPDATE` does not reapply column defaults. |
| settings.ts:85, :139 | `id` | `on conflict (id) do update set ...` (id is fixed to 1 by a check constraint) |
| news.ts:14 | `url`, ignoreDuplicates | `insert ... on conflict (url) do nothing returning id`. The returned row count equals the number actually inserted, matching the current semantics (:15). The "1000-row cap" comment (:7) disappears; chunking can stay for parameter-limit reasons (Postgres allows 65535 bind parameters per statement, so chunk by `floor(65535 / ncols)`, not by row count alone). |

- PostgREST upsert semantics to preserve: PostgREST `on_conflict` upserts do a bulk `insert ... on conflict do update set col = excluded.col` over **the columns present in the payload**. So the column list of the SQL `do update set` must be the payload's columns minus the conflict keys, not a fixed list. If rows in a chunk have different key sets, PostgREST uses the union and fills missing with defaults (`missing=default`) or null. Check the row types in rows.ts; they look uniform.
- Duplicate-in-batch: the repos already dedupe via `unique` before chunking (prices-intraday.ts:46, lottery.ts:119, financials.ts:35, financial-lines.ts:40, prices-daily.ts:140, signals.ts:53). Keep that. Postgres errors with `ON CONFLICT DO UPDATE command cannot affect row a second time` (SQLSTATE 21000) otherwise, as PostgREST also would.
- Partial unique indexes: lottery_tickets has two unique indexes (lottery.ts:29 does a plain insert; raw_text and sms identity, 20261106000100:64-70). An ON CONFLICT on those would need the matching index predicate; plain INSERT with 23505 to CONFLICT (errors.ts:34) is the existing behaviour and stays.
- Query-builder translation of non-upsert calls:
  - `.range(from,to)` becomes `limit/offset`; `fetchAll` (errors.ts:54-65) can become a single query because the PostgREST `max_rows` cap no longer applies. This also removes the non-snapshot paging inconsistency noted at errors.ts:52. Caution: keep the paged helpers if they bound memory. With `pg`, use a single `select` for the ranges the callers need (prices-daily.ts:32-80, corporate-actions.ts:20, data-gaps.ts:41, transactions.ts:26).
  - `.select(..., {count:'exact'})` (transactions.ts:49-57) becomes `count(*) over()` or a second `select count(*)`. A single statement with a window count is consistent.
  - `.in('symbol', [...])` becomes `= any($1::text[])`. Pass a JS array; `pg` serializes it. An empty array is valid in `= any('{}')` and returns no rows, whereas PostgREST `in.()` also returns none. Keep any early-return guards.
  - `.is('resolved_at', null)` becomes `is null`.
  - `.update(...).eq(...).select(...).maybeSingle()` becomes `update ... where id=$1 returning cols`, with `rows[0] ?? null`.
  - `.insert().select().single()` becomes `insert ... returning`.
  - `.update(...).in('id', ids).is('resolved_at', null)` (data-gaps.ts:60,67): add `returning id` if the caller uses the count.
  - `ai_reserve`: `select * from public.ai_reserve($1,...,$7)`. The result is a row set, and `reserveAiUsage` already accepts array-or-object (ai-usage.ts:34-35).
  - `ai_month_spend`: `select public.ai_month_spend($1,$2) as v`. Note this returns bigint, so the driver gives a string; `toSafeInt` accepts strings (packages/core/src/db/mappers.ts:24-35). Good.
- **Driver type parsing is the biggest behavioural risk.** PostgREST gives JSON, so today bigint is a JSON number, dates are `YYYY-MM-DD` strings and timestamptz are ISO strings. node-postgres `pg` returns:
  - `int8`/`bigint` as string. This is probably fine because `toSafeInt` accepts strings, but check mappers that expect `number`, e.g. direct reads like `row.concentration_threshold_ppm` (settings.ts:98) or in rows.ts.
  - `date` as a JS `Date` at local midnight. This is a timezone bug waiting to happen (VN dates, UTC container). Register a type parser for OID 1082 returning the raw string, and for 1184 (timestamptz) decide between ISO string and `Date`. Mappers presumably expect ISO strings, since ISO came from JSON.
  - `numeric` is absent by design (checks.sql:39-45), so no concern.
  - `jsonb` is parsed to objects (as PostgREST does). `text[]` is parsed to arrays. `bigint[]` is not used.
  - Set the parsers on a per-pool `types` option, not via the global `pg.types.setTypeParser`, which leaks across tests and consumers.
  - Timestamps in the ai_reserve window: pass ISO strings (they are already `fromTs/toTs`), cast `$n::timestamptz`.
- Error mapping: `unwrap` reads `res.error.code` (errors.ts:25-34), a SQLSTATE. `pg` errors expose `.code` with the same SQLSTATE, so the 23505, 23502, 23514 and 22P02 mapping survives. Wrap each query in a small adapter that returns `{data, error}` (cheapest path to keep every repo and test working, though it keeps a PostgREST-shaped interface), or refactor repos to throw. The acceptance criterion says same public functions; the adapter route lets you keep `Db = Pick<SupabaseClient,'from'|'rpc'>` out of the public type (client.ts:3). `Db` is exported, so callers that construct it (web server, worker, tests via packages/db/test/fake-client.ts) will change. Grep callers of `createServiceClient` before choosing.
- Tests: all repo tests use a fake supabase-style client (packages/db/test/fake-client.ts). Moving to SQL means those tests no longer exercise real behaviour. "Repo tests work without Supabase" can be met either by (i) keeping the fake behind a narrow `query(text, params)` interface and asserting SQL text/params (brittle), or (ii) running repo tests against the throwaway Postgres from db:check, or `pg-mem`/PGlite. PGlite (WASM Postgres) supports `ON CONFLICT`, identity, jsonb, arrays, advisory locks (single connection) and needs no binaries, but verify it handles `gin` index on `text[]` and `pg_column_size`. I recommend a real-PG integration layer (reuse the db-check bootstrap, in CI only, opt-in locally) plus unit tests on pure SQL builders.

**7. Data migration from Supabase**
- Dump only what is needed: `pg_dump --data-only --schema=public --no-owner --no-privileges --disable-triggers` is NOT recommended (needs superuser to disable triggers, and the schema has no triggers). Better: (1) create the schema on the new DB by running the migration chain (not by dumping DDL, since the dump would carry Supabase roles, RLS, default privileges, and extension statements); (2) load data only.
  - Dump command: `pg_dump "$SUPABASE_DIRECT_URL" --data-only --schema=public --no-owner --no-privileges --exclude-table=public.ai_keys -Fc -f stoktok.dump`, then `pg_restore --data-only --no-owner -d "$NEW_URL" stoktok.dump`.
  - Use the Supabase **direct** connection (port 5432, not the pooler on 6543), since `pg_dump` needs session features that the transaction pooler breaks. Check IPv4/IPv6 reachability from the home server; Supabase's direct host may be IPv6-only (this is a known pitfall; the session pooler is the IPv4 alternative and works with pg_dump).
  - Version: use a `pg_dump` at least as new as the Supabase server's major version (Supabase is on PG15/17 depending on project age). Restoring to an older target major than the source can fail on unknown settings. Pin the new instance's major to at least the source.
- `ai_keys`: exclude it. The rows reference `vault.secrets` ids that will not exist (ai_keys.sql:15). The ticket already says keys are re-entered. If `ai_keys` is restored with orphan `secret_id`s, the new schema (no `secret_id`) would also mismatch. Truncate/skip it. Also `ai_usage` does not hold secrets, so keep it, because the monthly budget gate (ADR 0008) depends on spend history in the current window; dropping it would reset the month's budget to zero.
- Load order and FKs: only one FK exists, `ai_summaries.usage_id -> ai_usage(id)` (ai_summaries.sql:13). `pg_restore` orders table data by dependency. With `-Fc`, data-only restore orders via the TOC. If using plain SQL `COPY`, load `ai_usage` before `ai_summaries`. Keep `--single-transaction` so a failed restore leaves nothing.
- Sequences: after restore run `select setval(pg_get_serial_sequence('public.transactions','seq'), coalesce(max(seq),1), max(seq) is not null) from public.transactions;` and the same for `data_gaps.id`, `signals.id`, `news.id`, `ai_usage.id`, `ai_summaries.id`. `pg_dump --data-only` includes `SELECT pg_catalog.setval(...)` for sequences, but verify with a row-count and max(id) vs sequence `last_value` check. For identity columns `pg_get_serial_sequence` works (it handles identity).
- `GENERATED ALWAYS` + COPY: allowed. `OVERRIDING SYSTEM VALUE` is only needed for INSERT. So do not use `--inserts` or `--column-inserts`.
- Role ownership and ACLs: `--no-owner --no-privileges` avoids restoring `supabase_admin` ownership and the `service_role` grants. Without these flags the restore fails or creates junk.
- Constraints re-validation: all checks are inside table definitions, so data is re-validated on COPY. A failure means pre-existing data violates a constraint (unlikely, same migrations).
- Verification (should be scripted in the runbook): per-table `count(*)` plus a checksum on both sides, e.g. `select md5(string_agg(t::text, '|' order by <pk>)) from public.<table> t`, for each of the 17 data tables. Run through the same driver the app uses and compare. Also compare `sum(quantity*price)` and max(trade_date) on transactions as a business sanity check, and `settings` row id=1.
- Freeze writes during cutover: the worker (jobs for prices, news, signals, AI) keeps writing. Stop the worker and set the web app read-only (or stop it) between dump and switch, then switch `DATABASE_URL`. A fully scripted cutover is: stop worker, dump, restore, verify, flip env, start. The downtime is minutes for a single-user dataset.
- Dry run: the runbook should be tested against a scratch database first (`createdb stoktok_scratch`), and the restore should be repeatable (`drop owned by` or recreate the DB). Add a script, e.g. `scripts/db-migrate-from-supabase.sh`, that refuses to run against a non-empty target unless forced (check `count(*)` on `transactions`).
- Backups: `pg_dump -Fc` nightly via cron or a compose sidecar, with retention (e.g. 14 daily and 8 weekly), written to a path outside the Postgres data volume, ideally copied off the host. Test a restore monthly. `pg_dump` of just `public` needs only `stoktok_owner` or a read role; do not use the app role. Note the `ai_keys` ciphertext is in the dump, so the dump is sensitive, and the master key must be stored separately from backups.

**8. Pooling and server-only config (touches the DB layer)**
- `pg.Pool` per process. Suggested limits: web `max 5`, worker `max 3`, `idleTimeoutMillis` 30s, `connectionTimeoutMillis` 5s, `statement_timeout` about 30s and `idle_in_transaction_session_timeout` about 30s, set per role (`alter role stoktok_app set ...`) so it applies regardless of client. Postgres default `max_connections=100` is far above this.
- Next.js: create the pool lazily and cache it on `globalThis` in dev to avoid one pool per HMR reload. Ensure it stays out of any client bundle: `packages/db` should keep `import 'server-only'` or equivalent, and the bundle check at scripts/check-no-service-key-in-client.sh must look for the new env var name and for the DSN's password and host. `.env.example`, scripts/check-image.sh, scripts/check-deploy-env.sh, deploy/deployment-repo/apps/stoktok/compose.yml and deploy/deployment-repo/.github/workflows/deploy-stoktok.yml all reference `SUPABASE_SERVICE_ROLE_KEY` and must change. packages/db/src/r3-guard.test.ts and client.test.ts too.
- The Supabase Auth keys (anon/publishable key, URL) still need to exist for login. The service role key is no longer needed by the DB layer at all. Check whether `requireUser()` or `/login` use it before removing it from env.

## Recommendations (tie each to an AC / rule)
1. Baseline vs forward migrations (AC3). Because the chain cannot run on plain PG, produce a single new baseline `supabase/migrations/…_baseline.sql` (or rewrite the existing files in place, since no non-Supabase DB has ever run them) that contains the DDL without roles/RLS/Vault, plus default-privilege grants for `stoktok_app`. In-place edit is defensible here because the only live DB is the Supabase one, which will be abandoned (the data move goes by data-only dump). Ming must confirm. If in-place, keep the filenames and ordering so the rollback pairing still works; otherwise add a squashed baseline and move the old files to `supabase/legacy/`. Either way this keeps `db:check` rollbacks working.
2. Roles (AC3, R3): `stoktok_owner` plus `stoktok_app`, with grants through `alter default privileges for role stoktok_owner`. The role names are fixed constants, and bootstrap is a documented one-time step outside the migration chain. No RLS, or if kept, no policies and `stoktok_app` owns nothing. I recommend dropping RLS and the "no policies" checks, and relying on grants plus network isolation. Note this is a weakening versus defense-in-depth against a leaked `stoktok_app` credential only if RLS had policies, which it does not. So there is no loss.
3. AI keys (AC4): app-side AES-256-GCM with a versioned envelope (`v1:<iv>:<ct>:<tag>`), master key from server-only env (separate from the DSN), `ai_keys(provider pk, secret_ct text, last4, updated_at)`. Include a key id so the master key can rotate. Delete the three DEFINER functions, so the DEFINER allowlist becomes empty. The new ADR supersedes 0009. State clearly that the master key must be backed up separately: losing it means re-entering keys, which is acceptable per the ticket.
4. Keep `ai_reserve` and `ai_month_spend` as SQL functions (AC1 says keep them): they are already invoker with an empty search_path, so only the grants change. Re-run the gate checks as `stoktok_app`. They are the only place the advisory lock lives, so do not reimplement the gate in TypeScript.
5. Driver (AC1): `pg` with a thin typed query helper plus explicit SQL strings in each repo. A query builder (Kysely) is the alternative: it brings typed upserts but needs a schema type file and adds a dependency. With 17 small repos and hand-written SQL already being the clearest translation of `onConflict`, I recommend `pg` plus a `query<T>(text, params)` adapter that returns the `{data,error}` shape first, so repos and `unwrap` keep working. Then migrate repos one at a time to throw-style if desired.
6. Register `pg` type parsers (date as string, timestamptz as ISO string, int8 as string with `toSafeInt` or as number with an overflow guard) on the pool via the `types` option, and add a test per type.
7. db:check (AC3): rework as in Findings §5, and add (a) a privilege-matrix test of `stoktok_app` (can DML, cannot DDL/TRUNCATE), (b) an `aclexplode` PUBLIC-grants test on tables, sequences and functions, (c) a rollback leftover check for functions and sequences, (d) an upsert test per repo conflict key run through the real driver.
8. Data migration (AC6): schema from migrations, data-only dump with `--no-owner --no-privileges`, exclude `ai_keys`, fix sequences, verify with per-table count and checksum, freeze the worker during cutover, and test against a scratch DB first. Ship it as a script plus runbook.
9. Order relative to STK-077: do the migration ticket first, or STK-077 will write a second set of repos against supabase-js that must be rewritten. If STK-077 is already underway, merge it first only if it adds no new tables or RPCs.
10. Split suggestion (R7): (a) roles + migrations + db:check (no app changes, still on Supabase via the old client? no, this must be one DB or the other, so land it behind the new `DATABASE_URL`), (b) driver + repos, (c) AI keys + ADR, (d) data migration + backups + docs and CLAUDE.md. Slices (a) and (b) cannot be fully independent, because db:check relies on the role names and the repos rely on grants. Suggest (a)+(b) with the real-PG tests as one ticket, (c) and (d) separate.

## Risks
- `date` returned as JS `Date` with the wrong timezone silently shifts trade dates and breaks R2/ledger ordering. Highest risk; needs the type parsers and tests.
- Editing merged migrations in place is wrong for any DB that already ran them. It is acceptable only because the target DB is new and the data goes by data-only dump. Needs Ming's confirmation.
- `on conflict do update` column sets that diverge from the PostgREST payload semantics can silently drop or overwrite fields (see ai_summaries `created_at`, symbols). Test each repo.
- Loss of RLS: no real security loss today (no policies, single client role), but anyone with the DSN has full DML. Keep the app credential server-only and out of pgAdmin shared sessions; use a separate `stoktok_owner` credential for pgAdmin.
- pgcrypto-in-SQL would put the master key into logs and `pg_stat_statements`. Avoid it (hence app-side).
- Supabase direct connection IPv6 and the PgBouncer pooler break `pg_dump`. Verify before the cutover day.
- Restoring `ai_keys` rows with dangling `secret_id`: exclude the table.
- `ai_usage` omitted from the migration resets the monthly AI budget window.
- PG version drift between Supabase (15/17) and Ming's server, and between CI (16) and prod. Check `select version()` on Ming's instance and PG14 `public` schema CREATE default.
- Fake-client tests (packages/db/test/fake-client.ts) give false confidence after the move; without a real-PG layer, SQL typos in `on conflict` targets would only fail in production.
- The advisory lock and `now()` semantics in `ai_reserve` assume one statement per call and no long app transaction; a transaction-wrapped call from the new driver would hold the lock longer and could evaluate `now()` early.

## Open questions
1. May the existing migration files be edited or squashed (new DB never ran them), or must the chain stay append-only with a new "de-Supabase" migration? The latter is impossible for `ai_keys.sql:6-11` unless Vault is stubbed. Which does Ming prefer?
2. What PG major version does Ming's server run, and is `public` CREATE already revoked from PUBLIC (PG15+)? Is `pgcrypto` allowed, if the planner prefers it over app-side encryption?
3. Where does the DB live relative to Docker Compose (host.docker.internal, a compose service, or LAN IP), and is TLS needed on that hop? Does pgAdmin connect as a superuser or as `stoktok_owner`?
4. Keep RLS at all? I recommend dropping it. If kept, the app role needs BYPASSRLS or policies.
5. One shared `stoktok_app` login for web and worker, or one per process (better attribution and per-process limits)?
6. Is a daily `pg_dump` enough (RPO 24h), or does Ming want WAL archiving? Where is the off-host copy stored?
7. Should repo tests run against a real PG (CI service container, local opt-in) or PGlite? This decides what replaces fake-client.ts.
8. Is the master key for AI-key encryption stored in the same deploy-repo secrets as the DSN, and is rotation needed in v1?
9. Does `requireUser()` / `/login` use the Supabase service role key anywhere? If not, it can be removed from the web and worker env entirely.
10. Rename `supabase/` directory and the `supabase/README.md` in this ticket or as a follow-up?

Files referenced (absolute): /home/user/stoktok/supabase/migrations/*.sql, /home/user/stoktok/supabase/rollback/*.sql, /home/user/stoktok/supabase/README.md, /home/user/stoktok/scripts/db-check.sh, /home/user/stoktok/scripts/db-check/bootstrap-roles.sql, /home/user/stoktok/scripts/db-check/checks.sql, /home/user/stoktok/packages/db/src/client.ts, /home/user/stoktok/packages/db/src/errors.ts, /home/user/stoktok/packages/db/src/repos/*.ts, /home/user/stoktok/packages/core/src/db/mappers.ts.

Caveat: I did not open rows.ts, mappers.ts in packages/db, the `symbols.ts` second upsert body, the 20261108000100_financial_lines unique key, or the apps/ callers of `createServiceClient`; the column-set and `Db`-type claims above should be confirmed by the planner.
