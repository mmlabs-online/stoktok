Status: READY

# Plan — STK-083: Plain-Postgres baseline migration and faithfulness proof (STK-080 slice d, part 1 of 3)

This ticket is too big for one implement/review cycle (see `## Split proposal`). **This plan covers slice 1 only:** the squashed baseline, its rollback, the schema-diff proof, `test:db` switched to the baseline, and CI on Postgres 17. The db:check rewrite becomes STK-086. The migrate runner and the worker `migrate` command become STK-087.

## Spec summary
Ticket `## Goal` (quoted, with the parts this slice implements in **bold**):
> **One squashed baseline plus rollback under a new `db/migrations` (old `supabase/` files kept read-only for reference and excluded from runners). No Supabase roles, no Vault, no RLS, no `grant`/`create role` in migrations: the single `stoktok` role owns everything.** A Node migrate runner modelled on TuDoCuaTui `server/migrator.js` … [→ STK-087]. db:check rewritten for the single-owner model … [→ STK-086]. **`test:db` template switched to the baseline. CI Postgres image moves to 17 (production major). A recorded normalised `pg_dump --schema-only` diff vs Supabase (grants and Vault excluded) proves the squash is faithful.**

Ticket `## Shared-Postgres standard`:
> One login role + one database per app, same name (`stoktok`) … The role owns its database and schema `public`; it has no CREATEROLE/CREATEDB/superuser. The same role runs the app and the migrations.
> No RLS for single-user (TuDo D25 pattern).
> **Release rule:** STK-081 to STK-083 merge to main but no stoktok release is cut until STK-084.

Acceptance criterion 3 (STK-082 plan F2):
> The baseline reproduces the STK-082 `ai_keys` shape (ciphertext/iv/auth_tag/key_version/last4/updated_at with their checks) without the real-Vault guard, RLS or grants; drops the db:check Vault stub; lists `ai_keys` as an intentional difference from Supabase in the recorded schema diff.

This slice covers everything in F2 except "drops the db:check Vault stub". That part needs the db:check rewrite and moves to STK-086.

ADR 0010 §7: "One login role and one database, both named `stoktok` … **RLS is disabled.**" ADR 0010 §9: "The migration history is squashed into one plain-Postgres baseline; the old `supabase/` files are kept for reference." ADR 0011 Consequences: migration `20261111000100` "exists for db:check, test:db and the STK-083 baseline."

## Decisions on the consult's open questions
| # | Question | Decision | Why |
|---|---|---|---|
| 1 | `revoke execute … from public` on `ai_reserve` and `ai_month_spend` | **Keep it in the baseline, as `from public` only.** Drop `anon, authenticated` from the old lines, because those roles do not exist on plain Postgres and the statement would fail. | It is a revoke, not a grant, so the ticket's "no `grant`/`create role`" still holds. It makes the invariant uniform: no object in `public` has any PUBLIC privilege, so STK-086's `aclexplode(coalesce(acl, acldefault(...)))` check needs no carve-out for functions. It is also defence in depth for the later least-privilege runtime role (TuDo D24 follow-up): granting that role USAGE on `public` would otherwise expose both functions to PUBLIC. Without the revoke, `has_function_privilege('stoktok_nobody', …)` would report true. |
| 2 | db:check applies migrations via the Node runner or via psql | **psql**, one `--single-transaction -f` per file, logged in as the owner role (implemented in STK-086). The runner is covered by `test:db`: STK-087 builds the template through `runMigrations`, so every `test:db` run exercises it. | db:check stays bash + psql and needs no Node, tsx or worker build, so it runs anywhere Postgres binaries exist. The runner runs each file in its own transaction, which equals `--single-transaction`. The static lint in this slice forbids transaction control in migration files, so the two paths cannot diverge. Using psql also keeps `schema_migrations` out of db:check's table and ACL checks. |
| 3 | Vendor `app-db.sql` | **Vendor it** (STK-086) as a byte-identical copy at `scripts/db-check/app-db.sql`. Record its provenance (deployment-repo path, sha256, copy date) in the `db-check.sh` header, not inside the file. | The deployment repo is private. Checking it out in PR CI would need a cross-repo token in stoktok's CI. The only such token today is `DEPLOY_REPO_TOKEN`, which has write scope and is for releases only. A byte-identical file can be re-diffed against upstream at any time. |
| 4 | Optional live-Supabase `pg_dump` | **No.** | Ming has no manual step in this ticket. Agents must not hold production DB credentials. Side A (the repo chain through `20261110000300`) is exactly what was applied to Supabase. STK-084's data-only restore into the baseline fails loudly on any column mismatch. Follow-up F1 suggests that STK-084 compare a live schema dump as part of Ming's cutover runbook. |
| 5 | Baseline version | **`20261111000200`** → `db/migrations/20261111000200_baseline.sql`. | It sorts after the last legacy version (`20261111000100`). It is deterministic now, whereas the merge date is unknown when the file is written. No database has a `schema_migrations` row yet, so the value only needs strict ordering. Once STK-084 applies it, it is never renamed. |
| 6 | Who updates the CLAUDE.md Stack/DB rows | **STK-084.** | Until the cutover, the running production release really is Supabase-backed, so "DB: Supabase … Migrations in `supabase/`" stays true for production. The cutover is when it changes. Project instructions are also not edited by the loop without Ming. This slice adds pointers in `supabase/README.md` and `db/migrations/README.md`. |
| 7 | PG17 binaries in cloud sessions | **Not installed here.** `/usr/lib/postgresql/` contains only `16` (`/usr/lib/postgresql/16/bin/pg_dump` is the only pg_dump). This does not block the ticket. | The baseline uses nothing newer than PG13 (`gen_random_uuid` is core). The faithfulness proof compares two schemas with the **same** binary on the **same** server, so it holds on 16. `schema-diff.sh` prints the server and pg_dump versions, and `schema-diff.md` records them. CI moves to `postgres:17`, so every CI `test:db` run applies the baseline on the production major. STK-086 adds the major-version assertion: hard fail when `CI` is set, warning locally. |

## Acceptance criteria → verification
| # | Criterion (this slice) | How the reviewer verifies it |
|---|---|---|
| 1 | One squashed baseline `db/migrations/20261111000200_baseline.sql` and its rollback `db/rollback/20261111000200_baseline.down.sql` exist. `supabase/migrations` and `supabase/rollback` are unchanged (read-only reference). | `git diff --stat main -- supabase/migrations supabase/rollback` is empty. Both new files exist. `migrations-lint.test.ts › file names and parity` passes. |
| 2 | The baseline has no Supabase roles, Vault, RLS, `grant`, `create role`, extensions, definer functions, `drop`, `if not exists` or `or replace`. The only privilege statements are the two `revoke execute … from public`. | `pnpm test` › `migrations-lint.test.ts › forbidden statements` and `› baseline is plain create`. `test:db` › `baseline.test.ts › single-owner shape` (no `relrowsecurity`, `pg_policies` empty, `pg_extension = {plpgsql}`, no `prosecdef`). |
| 3 | `ai_reserve` and `ai_month_spend` carry no PUBLIC EXECUTE (decision 1). | `test:db` › `baseline.test.ts › functions have no PUBLIC execute`, which uses `aclexplode(coalesce(proacl, acldefault('f', proowner)))` and expects no grantee 0. |
| 4 | (F2) `ai_keys` has the STK-082 shape and checks, with no Vault guard, RLS or grants. | `test:db` › `baseline.test.ts › ai_keys keeps the STK-082 shape`. The existing `test-db/ai-keys.test.ts` passes on the baseline template. Static lint finds no `vault`, no `do $` block and no `drop` in the baseline. |
| 5 | The squash is faithful: the normalised schema of the full legacy chain (A′) equals the baseline (B). | `bash scripts/schema-diff.sh` exits 0 and prints `A' vs B: identical`. The output matches `work/tickets/STK-083/schema-diff.md`. |
| 6 | (F2) The recorded diff vs what Supabase runs (A = legacy chain through `20261110000300`) shows **only** the intentional `ai_keys` difference. | Read `work/tickets/STK-083/schema-diff.md`. The A vs B raw diff contains only: the `ai_keys` column set (`secret_id` vs ciphertext/iv/auth_tag/key_version/last4), its check constraints, the `ai_keys` table comment, and the three `ai_key_set`/`ai_key_delete`/`ai_key_secrets` functions. Each hunk is labelled intentional. |
| 7 | The baseline applies as a non-superuser owner (no CREATEROLE/CREATEDB) and its rollback leaves no relation, function or type in `public`. Re-apply works. | `schema-diff.sh` side B: role created `nosuperuser nocreatedb nocreaterole noreplication nobypassrls`, schema `public` owned by it, PUBLIC revoked. It applies, runs the down file, prints `0 0 0` for `pg_class`/`pg_proc`/`pg_type` in `public`, then re-applies. The script exits non-zero otherwise. |
| 8 | Applying the baseline to a non-empty database fails loudly and changes nothing. | `test:db` › `baseline.test.ts › re-apply fails with 42P07 and changes nothing`. |
| 9 | The `test:db` template is built from `db/migrations` only, with no `bootstrap-roles.sql` and no `supabase/`. | Read `packages/db/test-db/global-setup.ts`. `grep -n "supabase\|bootstrap" packages/db/test-db/*.ts` finds nothing. `pnpm test:db` is green. |
| 10 | CI Postgres image is 17. | `.github/workflows/ci.yml` service image is `postgres:17`. CI is green on the PR. |
| 11 | Production keeps working: nothing in this slice changes the running release. | `git diff --stat main` touches no `apps/**`, no Dockerfile, no `release.yml`, no `scripts/check-*.sh` and no deploy docs. No release branch is created. |
| 12 | `typecheck`, `lint`, `test`, `test:db` and `db:check` are green. | Run all five. `db:check` is unchanged in this slice and still applies the legacy chain until STK-086. |

## Ming verification after merge
None. No release is cut, and production is untouched until STK-084.

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `db/migrations/20261111000200_baseline.sql` | **Create.** Mechanical concatenation of `supabase/migrations/*` in version order, with the strips and keeps listed in Approach step 1. | The core deliverable (criteria 1, 2, 4). |
| `db/rollback/20261111000200_baseline.down.sql` | **Create.** Drop the 2 functions (full signatures), then the 18 tables in FK-safe order (`ai_summaries` before `ai_usage`). Plain `drop`, no `if exists`, no `cascade`, no `drop owned`. | Criterion 7. Under `db/rollback`, because the runner's file regex rejects `.down.sql` in its directory and the image must not ship it (consult §1, §4). |
| `db/migrations/README.md` | **Create.** Rules adapted from TuDo `db/migrations/README.md`. See Approach step 2. | Documents forward-only use, expand/contract and the forbidden statements for future tickets. |
| `.gitattributes` | **Create.** `db/**/*.sql text eol=lf` | Stable checksums for the STK-087 runner (consult §5). |
| `packages/db/src/migrations-lint.test.ts` | **Create.** Static lint over `db/migrations` and `db/rollback` (in `pnpm test`, no DB needed). | Criteria 1, 2, 4. R8. |
| `packages/db/test-db/baseline.test.ts` | **Create.** Real-Postgres checks of the baseline shape. | Criteria 2, 3, 4, 8. |
| `packages/db/test-db/global-setup.ts` | **Modify** `migrate()`: read `db/migrations`, require every `.sql` to match `^(\d{14})_([a-z0-9_]+)\.sql$` (throw otherwise), sort, and apply each file as `begin; … commit;` as today. Remove the `bootstrap-roles.sql` read and the `supabase/migrations` path. | Criterion 9. STK-087 later swaps this loop for `runMigrations` as a non-superuser owner. |
| `packages/db/test-db/ai-keys.test.ts` | **Modify.** Delete the `describe('migration guard', …)` block (lines 222-241) and the imports it alone used (`readFileSync`, `join`, `pg`, if they become unused). Update the line 1 comment to "Runs over the migrated template (db/migrations baseline)". | That test applies the legacy `supabase/migrations/20261111000100` file to exercise the Vault guard. The baseline deliberately has no guard (F2), and test:db must no longer read `supabase/`. |
| `packages/db/src/pg/schema.ts` | **Modify** the header comment only (line 2): "Mirrors db/migrations; update in the same PR as any migration." | ADR 0010:27 and the comment name STK-083 as the switch. |
| `.github/workflows/ci.yml` | **Modify.** `image: postgres:16` → `postgres:17`. | Criterion 10 (ticket: "CI Postgres image moves to 17"). |
| `scripts/schema-diff.sh` | **Create.** One-off, reproducible faithfulness proof. Not in CI and not in `package.json`. See Approach step 5. | Criteria 5, 6, 7. |
| `work/tickets/STK-083/schema-diff.md` | **Create** (implementer, from the script's output). Commands, PG and pg_dump versions, A′ vs B result, A vs B raw diff with each hunk labelled intentional, down round-trip result. | Criteria 5, 6 (ticket: "A recorded normalised `pg_dump --schema-only` diff"). |
| `supabase/README.md` | **Modify.** Add a top banner: "Frozen reference since STK-083. The schema source is `db/migrations` (squashed baseline). Never edit these files. test:db no longer applies them; db:check still does until STK-086; `scripts/schema-diff.sh` uses them for the faithfulness proof." Leave the rest. | Ticket: "old `supabase/` files kept read-only for reference". |
| `docs/adr/0010-self-hosted-postgres-data-layer.md` | **Modify.** Decision 9: append the baseline path and version, `db/rollback` for test-only down files, the proof location, the `revoke execute … from public` exception, and "db:check applies via psql (STK-086); the runner is exercised by test:db (STK-087)". Consequences line 27: "`schema.ts` … mirrors `db/migrations`". Slice order line 25: add STK-086 and STK-087. | Keeps the ADR true. These are recorded decisions 1, 2 and 5. |

Do **not** touch `scripts/db-check.sh`, `scripts/db-check/*.sql`, `apps/**`, Dockerfiles, `release.yml`, `.dockerignore`, `packages/db/src/pg/client.ts` or `CLAUDE.md`. They belong to STK-086, STK-087 and STK-084.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `packages/db/src/migrations-lint.test.ts › file names and parity` | Every entry of `db/migrations` is `README.md` or matches `^(\d{14})_([a-z0-9_]+)\.sql$`. Every entry of `db/rollback` matches `^(\d{14})_([a-z0-9_]+)\.down\.sql$`. The version+name sets are equal one-to-one. At least one migration exists. |
| `… › forbidden statements` | For every file in `db/migrations`, strip `--` line comments and `/* */` block comments, then forbid (case-insensitive, word-bounded): `grant`, `create role`, `alter role`, `create user`, `create extension`, `row level security`, `create policy`, `alter default privileges`, `security definer`, `set role`, `set session authorization`, `vault`, `concurrently`, `anon`, `authenticated`, `service_role`. Transaction control: additionally strip single-quoted strings and dollar-quoted bodies (`$tag$…$tag$`), split on `;`, and forbid statements starting with `begin`, `start transaction`, `commit`, `end`, `rollback`, `abort`, `savepoint`, `release` or `prepare transaction`. |
| `… › baseline is plain create` | Applies to `20261111000200_baseline.sql` only. No `if not exists`, no `or replace`, no `\bdrop\b`, no `\bdo\s+\$` block. Contains exactly two `revoke execute on function … from public;` statements and no other `revoke`. |
| `… › lint helpers catch their fixtures` | Flagged: `grant select on t to x`, `create index concurrently i on t (c)`, `commit;`, `begin;`, `alter table t enable row level security`. Not flagged: `granted boolean`, `v_granted := …`, a plpgsql body `as $$ begin … end $$;`, `-- grant all` in a comment, `'commit;'` inside a string. |
| `packages/db/test-db/baseline.test.ts › single-owner shape` | Exact list of the 18 tables in `public`. No table with `relrowsecurity` or `relforcerowsecurity`. `pg_policies` empty for `public`. `pg_extension` names equal `['plpgsql']`. Functions in `public` are exactly `ai_month_spend` and `ai_reserve`, neither `prosecdef`, both with `search_path=""` in `proconfig`. No `ai_key_set`/`ai_key_delete`/`ai_key_secrets`. |
| `… › functions have no PUBLIC execute` | `select … from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.pronamespace = 'public'::regnamespace and a.grantee = 0` returns 0 rows. Also assert the query returns ≥1 row without the `grantee = 0` filter (the owner entry), so the check cannot pass vacuously. |
| `… › ai_keys keeps the STK-082 shape` | Columns and types match `provider text`, `ciphertext bytea`, `iv bytea`, `auth_tag bytea`, `key_version smallint`, `last4 text`, `updated_at timestamptz` (all not null), and there is no `secret_id`. Valid rows at ciphertext 20 and 256 bytes insert. Rejected with 23514: provider `openai`, ciphertext 19 and 257, iv 11, tag 17, `key_version` 0, `last4` `'ab d'` and a non-ASCII value. `key_version` null → 23502 (no default). The table comment is present. |
| `… › re-apply fails with 42P07 and changes nothing` | On a fresh clone, one `pg.Client` runs `begin`, the baseline file text, then `rollback`. The error has code `42P07`. Table count and `pg_proc` count in `public` are unchanged afterwards. |
| Existing `test-db/*.test.ts` | All pass unchanged on the baseline template (except the removed migration-guard block). This is the behavioural proof that every repo works on the squashed schema. |

## Approach
1. **Build the baseline by concatenation** (consult §1), in legacy version order, from `20261023000100` to `20261111000100`:
   - Header comment: squashed from `supabase/migrations` `20261023000100`–`20261111000100` (STK-083); single-owner model (ADR 0010 §7); no RLS, grants or Vault; proof in `work/tickets/STK-083/schema-diff.md`; never edit once applied. Short `-- from <legacy file>` section markers are fine.
   - **Keep verbatim:** every `create table`, `create index`, `comment on`, constraint text and column order.
   - **Keep as separate statements:** the two `alter table … add` statements (`20261026000100_financials.sql:26` on `symbols`; `20261105000100_data_gaps_resolved_reason.sql:2-5`), so that `attnum` order and constraint names match. Do not inline them.
   - **Strip:**
     - all of `20261023000200_v1_rls_grants.sql`;
     - every `enable row level security`;
     - every `grant`, `revoke` and `alter default privileges`, except decision 1;
     - all of `20261110000200_ai_keys.sql`;
     - from `20261111000100`: the DO guard (:12-18), the `drop … if exists` lines (:20-23) and the RLS/grant lines (:37-39);
     - legacy comments that describe RLS, grants, `service_role` or Vault behaviour (for example `ai_usage.sql:2`).
   - **Functions:**
     - Create `ai_reserve` with plain `create function`, using the final header and body from `20261110000100_ai_reserve_harden.sql:4-48` byte-for-byte between `$$` (`prosrc` is compared by the diff). Place it where `ai_usage.sql` created it.
     - `ai_month_spend` comes from `ai_usage.sql:79-88`.
     - Then `revoke execute on function public.ai_reserve(text, text, text, bigint, bigint, timestamptz, timestamptz) from public;` and `revoke execute on function public.ai_month_spend(timestamptz, timestamptz) from public;`.
   - **`ai_keys`:** the final DDL (`20261111000100:25-33`) plus its comment (:35), at the end of the file (its last-created position in A′).
   - Plain `create` only. No `if not exists`, no `or replace`, no extension.
2. **`db/migrations/README.md`:**
   - Files are applied by the worker `migrate` command (STK-087) and by test:db. db:check applies them via psql (STK-086).
   - Name pattern `YYYYMMDDHHMMSS_snake_case.sql`. Forward-only; never edit an applied file.
   - One transaction per file. No `begin`/`commit`, `concurrently`, `create extension`, `grant`, `create role`/`alter role`, RLS, `security definer` or Vault. The lint enforces this.
   - Every new function needs `revoke execute … from public` (decision 1).
   - Expand-then-contract, so the previous image keeps working.
   - Every file has a matching `db/rollback/<version>_<name>.down.sql`. It is test-only, never shipped and never run in production; recovery is the pre-migration dump.
   - `supabase/` is a frozen reference.
3. **Rollback file:** drop `ai_reserve(…)` and `ai_month_spend(…)` with full signatures, then the tables: `ai_summaries`, `ai_usage`, `ai_keys`, then the other 15 in any order.
4. **`test:db` switch** (`global-setup.ts`): as in the Files table. Admin/superuser connection for now; STK-087 moves it to the owner role and the runner. Remove the `ai-keys.test.ts` migration-guard block. Add `baseline.test.ts`, using `freshDb()` for clones and a direct `pg.Client` on `t.url` for the re-apply test. Read the baseline file via `join(__dirname, '..', '..', '..', 'db', 'migrations', …)`.
5. **`scripts/schema-diff.sh`** (bash, `set -euo pipefail`; pattern copied from `db-check.sh:6-44`):
   - **Binaries.** `PG_BIN` is the env value, else the first of `/usr/lib/postgresql/17/bin` or `/usr/lib/postgresql/16/bin` that has `initdb`, else `pg_config --bindir`. Start a throwaway cluster with `initdb --auth=trust -U postgres` (unix socket only, `runuser -u postgres` when root) and clean up on EXIT. Print `postgres --version` and `pg_dump --version`. All dumps use this one `pg_dump`.
   - **A′** (db `legacy_full`): `supabase/` reference bootstrap (`scripts/db-check/bootstrap-roles.sql`, which stays in place in this slice), then all 15 `supabase/migrations/*.sql` with `--single-transaction`, as `postgres`.
   - **A** (db `legacy_supabase`): the same, excluding `20261111000100_*`. This is what Supabase runs (ADR 0011:54).
   - **B** (db `baseline`):
     - `create role stoktok_diff login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;` and `create database baseline owner stoktok_diff;`. Then, in `baseline`, `alter schema public owner to stoktok_diff; revoke all on schema public from public;` (mirrors `app-db.sql:13-37`).
     - Apply the baseline with `-U stoktok_diff --single-transaction`.
     - Apply the down file the same way. Assert `select (select count(*) from pg_class where relnamespace='public'::regnamespace), (select count(*) from pg_proc where pronamespace='public'::regnamespace), (select count(*) from pg_type where typnamespace='public'::regnamespace)` is `0|0|0`, else exit 1.
     - Re-apply the baseline. B is dumped after the re-apply.
   - **Dump each:** `pg_dump --schema-only --schema=public --no-owner --no-privileges --no-tablespaces`. Normalise with `sed -E '/^\\(un)?restrict /d; /ENABLE ROW LEVEL SECURITY;$/d; /^-- Dumped (from|by) /d'`.
   - **Compare.** `diff -u A′ B`: must be empty; print `A' vs B: identical`, else print the diff and exit 1. `diff -u A B`: print it under a heading. It is expected to be non-empty, so do not fail on it.
   - **Output.** Write both diffs and the three dumps to `${SCHEMA_DIFF_OUT:-$(mktemp -d)}` and print the path.
   - The script uses no secrets and no TCP.
6. **Record the proof:** run the script and write `work/tickets/STK-083/schema-diff.md` with:
   - the command, binary versions and date;
   - the A′ vs B result;
   - the A vs B raw diff in a code block, followed by a hunk-by-hunk note: "intentional: ai_keys Vault shape → app-side ciphertext (ADR 0011, F2)"; "intentional: ai_key_* definer functions removed (ADR 0011)".
   - Any other hunk is a defect in the baseline. Fix the baseline, not the record.
7. **CI:** `postgres:16` → `postgres:17`. Nothing else in `ci.yml`. db:check keeps `DB_CHECK_URL` against the same container and still applies the legacy chain (with the stub), which works on 17.
8. **Docs:** banner in `supabase/README.md`; ADR 0010 edits; `schema.ts` comment.
9. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:db` (local Postgres; PG16 binaries are fine in this session), `pnpm db:check` and `bash scripts/schema-diff.sh`.

**Rules:**
- R2: no column types change. The proof shows identical types, and `no_numeric_or_float_columns` still holds via db:check on the legacy chain.
- R3: no URL or credential is read or printed anywhere new. `schema-diff.sh` is unix-socket and trust-only.
- R5: not touched.
- R7: STK-086 and STK-087 scope stays out of the diff.
- R8: the lint unit test plus `baseline.test.ts`.
- R10: not affected.

## Specialist input used
`consult-database-optimizer.md`:
- **Adopted:**
  - §1: concatenation, keep the two `alter table … add`, the strip/keep lists, final `ai_reserve` body, plain `create`, no extension, version `20261111000200`, down file in `db/rollback`.
  - §1 open decision: revoke from PUBLIC, kept (decision 1).
  - §2: same binary for both sides, the pg_dump flags, `\restrict` stripping, A′ vs B must be empty, A vs B recorded with only `ai_keys`.
  - §4: down contents and order, `pg_class`/`pg_proc`/`pg_type` leftover check (used in `schema-diff.sh` now; db:check gets it in STK-086), no `drop owned`.
  - §5: static lint list, extended with `security definer`, `alter default privileges`, `set role`, `create policy` and the Supabase role names. Transaction control is checked with dollar bodies stripped, because plpgsql `begin` would otherwise false-positive.
  - §5: `.gitattributes`.
  - §7: CI `postgres:17`.
  - §8: `supabase/` frozen banner.
- **Adjusted:**
  - §1: the legacy revoke lines name `anon, authenticated`. The baseline keeps `from public` only, because those roles do not exist on plain Postgres.
  - §2: the old `bootstrap-roles.sql` stays where it is in this slice, because db:check still uses it. STK-086 moves it to `supabase/legacy/` and repoints `schema-diff.sh`.
- **Rejected:**
  - §2 optional live dump (decision 4).
  - Open question 2, "apply db:check via the runner" (decision 2: psql).
- **Moved to STK-086:**
  - §3 vendored `app-db.sql`, owner/nobody split, `checks-acl.sql`, `aclexplode` with `acldefault`, URL-mode safety;
  - §7 PG-major assertion and the `PG_BIN` default;
  - §8 legacy-reference guard test.
  - Two corrections for STK-086:
    - `expect_fail('create database zz')` cannot work inside checks.sql's transaction or a DO function: it raises 25001, not 42501. Assert `rolcreatedb = false` instead.
    - `create extension pgcrypto` would **succeed** for the database owner, because pgcrypto has been a trusted extension since PG13. Rely on the lint plus `pg_extension = {plpgsql}` instead.
- **Moved to STK-087:**
  - §5 runner, worker `migrate`, Dockerfile `COPY`, image smoke, runner unit and integration tests;
  - §6 owner-role template and clones;
  - §5 `schema.ts` drift test and `schema_migrations` handling.
- **Noted for STK-084 (follow-up F2 below):** STK-080 security-review S10 planned `idle_in_transaction_session_timeout` "on the role in STK-083". Under the shared standard the role belongs to the deployment repo and migrations must not `alter role`. It belongs in the session init or the deployment config.

## Assumptions
- **A1. Rollback location.** The ticket says "baseline plus rollback under a new `db/migrations`". The rollback goes to the sibling `db/rollback/`. TuDo's runner regex rejects `<v>_<n>.down.sql` in the migrations directory as a configuration error (exit 2), and the worker image will copy `db/migrations` only (STK-087). This keeps to the intent: a new `db/` tree, with `supabase/` untouched.
- **A2. db:check is unchanged in this slice.** It keeps applying the legacy chain plus the Vault stub until STK-086, and that is green: A′ = B is proven, so db:check still checks the same schema. **No schema-changing ticket (for example STK-077) should merge between this slice and STK-086**, or its migration would go unchecked by db:check. The orchestrator should run STK-086 next.
- **A3. Hotspots.** STK-082 and STK-085 are `DONE` and edited `packages/db/test-db/ai-keys.test.ts`, `global-setup.ts`, `scripts/db-check/checks.sql` and `supabase/README.md`. If their PRs are not merged yet, expect a rebase. This plan assumes their final shapes as read on 2026-11-11. No `src/App.tsx`-style hotspot.
- **A4.** `pnpm test:db` in this cloud session runs against a local Postgres 16 started from `/usr/lib/postgresql/16/bin` (as in prior tickets). CI runs it on 17.
- **A5.** The squash is valid for production because every legacy file through `20261110000300` was applied to Supabase in order and `20261111000100` never was (ADR 0011:54). The A vs B diff encodes exactly that.
- **A6.** CI on `main` builds and pushes `:latest` images on merge, as it does today. That is not a release: production is pinned by digest through `release.yml` and the deployment repo, so the release rule holds. This slice changes no image content anyway.

## Blocking questions
None.

## Split proposal
**Why:** the full ticket is about 470 lines of mechanical baseline SQL plus about 1,150 hand-written lines:
- runner and tests: about 440;
- worker command and image: about 80;
- db:check rewrite (`db-check.sh`, checks.sql edits, new `checks-acl.sql`): about 380;
- owner-role test:db: about 70;
- this slice's lint, tests and script: about 330.

It spans security-sensitive SQL, ACL checks and the deploy image. One implement/review cycle with a 2-rework cap would very likely escalate. Each slice below leaves production untouched (release rule) and all checks green.

| Slice | ID | Title | Scope | Depends on |
|---|---|---|---|---|
| 1 (**this plan**) | STK-083 | Plain-Postgres baseline and faithfulness proof | Baseline and rollback; `db/migrations/README.md`; `.gitattributes`; static lint; `schema-diff.sh` and the recorded diff; test:db template from the baseline; `baseline.test.ts`; CI on `postgres:17`; `supabase/` banner; ADR 0010 notes. Covers criterion 3 except "drops the db:check Vault stub". | STK-082 |
| 2 | **STK-086** (new) | db:check rewrite for the single-owner model | Vendored byte-identical `scripts/db-check/app-db.sql` with provenance in the header; `db-check.sh` applies `db/migrations` via psql `--single-transaction` **as the owner login** (decision 2), with a one-to-one `db/rollback` parity check, `PG_BIN` default 17 and a PG-major assertion (fail when `CI` is set, warn locally). URL mode: app name `DB_CHECK_APP` (default `stoktok`); refuse when any non-system database exists or the role/db already exists; password via stdin `\set` / `PGPASSWORD`, never argv. `checks.sql` runs as owner: delete the `set local role service_role` and `reset role` pairs; rename `service_role_can_*` to `owner_can_*`; replace the RLS-on and anon checks with RLS-off and `pg_policies` empty; delete `ai_keys_privileges`; replace the role half of `ai_functions_locked`; owner `pg_roles` flags all false; `create role` gives 42501; `pg_extension = {plpgsql}`. New `checks-acl.sql` runs as superuser in the app DB: `stoktok_nobody` denied (has_*_privilege plus `set local role` loops); `aclexplode(coalesce(acl, acldefault(kind, owner)))` with no non-owner grantee on relations, sequences, functions, types, schema `public` and the database; `pg_default_acl` empty; everything owned by the app role. Rollback phase: `pg_class`/`pg_proc`/`pg_type` all 0, and roles and `public` owner/ACL unchanged; then re-apply and re-check. Move `bootstrap-roles.sql` (with the Vault stub) out of db:check to `supabase/legacy/`, and repoint `schema-diff.sh`. Legacy-reference guard test: nothing outside `supabase/`, `work/`, `docs/`, `.claude/` and `scripts/schema-diff.sh` references `supabase/migrations` or `supabase/rollback`. Update the `supabase/README.md` PG16 text. Closes "drops the db:check Vault stub" (F2) and the ticket's db:check scope. Areas: db, security. | STK-083 |
| 3 | **STK-087** (new) | Migrate runner and worker `migrate` command | `packages/db/src/pg/migrate.ts`, a port of TuDo `migrator.js`: forward-only; `schema_migrations` table; sha256 checksum with CRLF normalisation; advisory lock key above 2^31; GUC `stoktok.migrating`; one transaction per file with `lock_timeout` and `statement_timeout`; dedicated `pg.Client` with `application_name: stoktok-migrate`; exit codes 0/1/2; never logs the URL. URL read only via a new accessor in `pg/client.ts` (R3, r3-guard). Worker `cli.ts migrate` subcommand with directory resolution (image `../migrations`, repo `db/migrations`). Dockerfile `COPY db/migrations ./migrations`, and verify `.dockerignore`. `check-image.sh` smoke: `migrate` without URL exits 2; with an unreachable DB exits 1 with no leak. Unit tests for `parseMigrationFilename`, `checksum` and `planMigrations`. test:db: owner role `stoktok_test_owner` (idempotent, 42710-safe, never dropped); template built via `runMigrations` as that role; clones `owner <role>`, and `freshDb` connects as the owner. Integration tests: idempotent re-run; checksum mismatch exits 1; a failing file rolls back with no row; concurrent runners serialise; DB-ahead applies nothing; `schema_migrations` holds exactly the baseline row. `schema.ts` vs `information_schema` drift test. Areas: db, security, architecture. | STK-083 (independent of STK-086) |
| — | STK-084 (existing) | Cutover | Unchanged. It additionally needs STK-086 and STK-087. Also carries F1–F3 below and the CLAUDE.md Stack/DB row update (decision 6). | STK-086, STK-087 |

**Follow-ups (not in this diff):**
- F1 (STK-084): Ming's cutover runbook can include a live-Supabase `pg_dump --schema-only` compared with side A (decision 4).
- F2 (STK-084 or a deployment-repo change): `idle_in_transaction_session_timeout`. Set it in the `pg/client.ts` session init or in the deployment-repo DB config, not in a migration.
- F3 (STK-084): update the CLAUDE.md Stack "DB" row and "Migrations in `supabase/`" (decision 6).
