Status: READY

# Plan — STK-091: Data-move script and cutover runbook (STK-084 slice A2) — slice A2a: the script, its test harness and CI

This plan covers **slice A2a**: `scripts/db-migrate-from-supabase.sh`, a test harness that runs it against two local Postgres databases, the CI wiring, and a short "Data move script" reference section in `docs/deploy.md`. The full cutover runbook (dry run, freeze, move, release, verification, AI keys, rollback per stage, day +14) is slice A2b and needs its own ticket (see `## Split proposal`). Nothing in this slice connects to the Supabase project. Nothing in it changes the running release.

## Spec summary
- STK-091 ticket.md Goal: "`scripts/db-migrate-from-supabase.sh` and the cutover runbook in docs/deploy.md, per the consults in work/tickets/STK-084/ and plan.md decision D4 (schema-diff mandatory in the dry run, informational at the real cutover)." AC: "Nothing applies a migration to the Supabase project; no secret is committed." "Repo checks green".
- STK-084 ticket.md Goal: "`scripts/db-migrate-from-supabase.sh`: refuses a non-empty target unless forced; schema from the baseline via the migrate runner; `pg_dump --data-only --schema=public --no-owner --no-privileges --exclude-table=public.ai_keys -Fc` from Supabase (direct or session pooler, port 5432; no `--inserts`); `pg_restore --single-transaction` into `stoktok` via the `db` network; `setval` for the 6 identity sequences; per-table count plus ordered md5 verification."
- STK-084 plan.md, split table row A2: "two legs on the right networks, `pgvector/pgvector:pg17-trixie` via `PG_CLIENT_IMAGE`, credentials via inherited env, migrate from the candidate worker image, empty-target refusal by row count, force = explicit TRUNCATE ... RESTART IDENTITY without `schema_migrations`, allow-listed DB names, `--exclude-table` `ai_keys` and `schema_migrations`, TOC check, `--single-transaction`, keep dumped sequence state and bump only if behind, ordered md5 with `COLLATE "C"` and source column list, `ANALYZE`, `ai_keys` 0 rows, job-lock check) plus `--schema-check` (mandatory in the dry run, D4) ... Never runs anything against the Supabase project except read-only `pg_dump`".
- STK-084 plan.md D4: "Mandatory in the dry run, informational (non-blocking) at the real cutover."
- STK-084 ticket.md, Ming 2026-11-17: "(2) Rollback window 14 days ... data written after the cutover is re-entered by hand; prefer fixing forward. (3) After the window, keep the Supabase `public` tables as a read-only archive".
- Orchestrator hard limits for this ticket: the script only reads from Supabase (read-only), never applies migrations or writes there; no secrets in files or argv; bash 3.2 compatible (macOS host); tests run in CI and locally without Supabase.
- CLAUDE.md R3: "`STOKTOK_DATABASE_URL` is read only in `packages/db/src/pg/client.ts` ... and `apps/worker`." R7, R8.

## Decisions taken in this plan
| # | Question | Decision | Why |
|---|---|---|---|
| S1 | "Read-only `pg_dump`" vs the source checksums the consults require (DB consult §6, data-engineer rec. 5) | Source access is **read-only**, and every source connection goes through one of two functions. `src_dump` runs `pg_dump`. `src_ro` runs `psql` with stdin SQL that starts with `set default_transaction_read_only = on; begin transaction isolation level repeatable read read only;` and ends with `rollback;`, under `ON_ERROR_STOP=1`. `src_ro` runs only fixed SELECTs: version, catalog lists, counts/md5, `pg_sequences`. No other code path names the source host. | Without source-side counts and md5 the move cannot detect a freeze violation (a write after the dump), which both consults rank as the top data-loss risk. A `READ ONLY` transaction cannot write, as `pg_dump`'s own transaction cannot. The harness proves it: the source test database is set to `default_transaction_read_only = on` at database level, and its fingerprint is compared before and after. Recorded under Assumptions in case Ming reads the limit as "pg_dump only". |
| S2 | How credentials reach the containers | **pg client legs:** a `pgpass` file in a private `mktemp -d` directory (umask 077, removed by an EXIT/INT/TERM trap). It is mounted `:ro` and selected with `-e PGPASSFILE=/secrets/pgpass`, with `:` and `\` escaped. **Migrate leg:** `STOKTOK_DATABASE_URL` is assigned in a shell variable and passed as an inherited `-e STOKTOK_DATABASE_URL` (no `=value`), with an env prefix on the `docker` call only. The source password comes from `MOVE_SRC_PGPASSWORD` if set, else a `read -rs` prompt on `/dev/tty`. With no tty and no variable the script exits 2. | No argv anywhere (consult §1, architect R7). A pgpass mount also keeps passwords out of the container config shown by `docker inspect`, where an inherited `-e PGPASSWORD` would land. The worker image only reads `STOKTOK_DATABASE_URL` (R3), so the migrate leg uses the same env shape the deploy's env_file gives it. |
| S3 | Container shape | Every pg client leg is `docker run --rm --user "$(id -u):$(id -g)" --entrypoint <pg_dump|pg_restore|psql> "$PG_CLIENT_IMAGE"`, with the work dir mounted at `/work`. Source legs use network `$MOVE_SRC_NETWORK` (default `bridge`). Target legs use `$MOVE_DST_NETWORK` (default `db`). TOC reads use `--network none`. Default `PG_CLIENT_IMAGE=pgvector/pgvector:pg17-trixie`. The script fails unless the client major is 17 and the target `server_version_num` is ≥ 170000; the client major must also be ≥ the source major. | DB consult §1 and §7. `--user` makes the dump file host-owned and lets libpq read the pgpass file. The configurable networks and image are what let the harness run with `--network host` and `postgres:17`. |
| S4 | What "the expected schema" is | Expected = `version` + sha256 of each file in the checkout's `db/migrations/*.sql`, using `shasum -a 256` (falling back to `sha256sum`). With `--worker-image`, the script first lists the image's `/app/migrations` (`docker run --rm --network none --entrypoint sh IMG -c 'cd /app/migrations && sha256sum -- *.sql'`) and fails unless it equals the checkout. After migrate, `schema_migrations` (version, checksum) must equal the expected set exactly; exit 0 from the runner proves nothing (DB consult §2). `--skip-migrate` (no image) runs the same assertion on an already-migrated target. | The runbook (A2b) runs the script from a checkout of the release tag. Comparing image and checkout catches the wrong tag. `--skip-migrate` is what the CI harness uses (no worker image in the `ci` job). It cannot weaken the guarantee, because the assertion is unchanged. |
| S5 | Modes | **`--dry-run`:** the target must match `^stoktok_scratch[a-z0-9_]*$`. The schema check always runs, and an unexpected difference makes the final verdict FAIL (exit 1). The data move still completes first, so one dry run shows every problem. Freeze checks only warn. The dump is deleted at the end unless `--keep-dump`. **Real run:** the target matches `^stoktok(_scratch[a-z0-9_]*)?$`. Freeze checks block. The schema check runs only with `--schema-check`, and its result never changes the exit code. The dump is kept and the script prints its path plus "delete on day +14". | D4. Ming 2026-11-17 (14-day window). DB consult §5 (allow-list) and §9 (dump retention). Real mode also accepts scratch names, so the harness can test the blocking freeze checks without creating a database called `stoktok`. |
| S6 | The schema-check normaliser | A portable awk filter (BSD and GNU) applied to both `pg_dump --schema-only --schema=public --no-owner --no-privileges --no-tablespaces` outputs. It drops `^SET `, `set_config` lines, `\restrict`/`\unrestrict` lines, `-- Dumped from/by`, `ENABLE ROW LEVEL SECURITY;` lines and every dump section (`-- Name: ...; Type: ...` header up to the next header) whose header is `ROW SECURITY` or whose name or body mentions `ai_keys`. The expected result is an empty `diff -u`. | DB consult §11. `scripts/schema-diff.sh` uses `sed -z` (GNU only), which does not run on macOS. Removing ai_keys sections reflects the recorded expected difference (STK-083 schema-diff: "ai_keys only"). |
| S7 | Where the tests live | A bash harness `scripts/test-db-migrate-from-supabase.sh` (the `db-check.sh` style: localhost-only URL, refuses a server that already holds its names, cleans up on exit). It runs as `pnpm test:move` and as a CI step after `db:check`. It needs Docker and `MOVE_TEST_URL`. | The script is shell and drives Docker, so a Vitest wrapper would add nothing. The CI runner has Docker and the `postgres:17` service image. Running after `db:check` means a leftover cannot trip db:check's "non-system database exists" refusal. |

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Happy path (dry run): schema asserted, data dumped with the exclusions, TOC checked, restored in one transaction, `ANALYZE`d. Every table's count and content equal the source by the script's own md5 **and** by an independent harness oracle. `ai_keys` has 0 rows on the target while the source has 1. Exit 0 | `pnpm test:move` › `t_dry_run_happy` |
| 2 | The source is never written: the run succeeds against a source database with `default_transaction_read_only = on`, and the source fingerprint (per-table count+md5, `pg_sequences`) is identical before and after. Every source call goes through `src_dump`/`src_ro` (S1) | `t_dry_run_happy` (fingerprint, read-only source); read the script: `grep -n 'MOVE_SRC_HOST'` shows it used only in those two functions and the preflight validation |
| 3 | No secret on argv, in output or in files that remain: neither sentinel password appears in the logged docker argv (PATH shim), in the script's stdout/stderr, or in any file left in the work dir. The pgpass dir is gone after exit, including after a failing run | `t_dry_run_happy`, `t_schema_drift` (failing run) › `assert_no_leak` |
| 4 | Sequences: the dump's sequence state is kept, never lowered. A sequence behind `max(col)` is bumped and reported. An empty table's uncalled sequence stays uncalled. Source and target `(last_value, is_called)` are compared before any bump | `t_dry_run_happy` (fixture deletes a tail row of `data_gaps`, inserts `news` with `overriding system value` above the sequence, and leaves `signals` empty) |
| 5 | Non-empty target refused, by row count over all `public` tables except `schema_migrations` (catalog, not a hand list). Nothing is written | `t_refuse_non_empty` |
| 6 | Force: `--force` without `--confirm <db>`, or with a different name, exits 2. With the matching name it runs one `TRUNCATE ... RESTART IDENTITY` over every public table except `schema_migrations`, re-moves, and leaves the `schema_migrations` row unchanged | `t_force` |
| 7 | Schema mismatch: target `schema_migrations` not equal to `db/migrations` (missing, or a changed checksum) exits 1 before any dump | `t_schema_migrations_mismatch` |
| 8 | Schema check (D4): a source with drift (extra column) makes the dry run end FAIL with a diff naming the table. A real run without `--schema-check` fails at restore and leaves the target empty (single transaction) | `t_schema_drift` |
| 9 | Allow-list and modes: targets `postgres`, `stoktok_other`, `Stoktok`, `stoktok;x` exit 2, and `--dry-run --target stoktok` exits 2, all before any `docker` call. `MOVE_SRC_SSLMODE=disable` with a non-local source host exits 2. A malformed password file exits 1 and names the file, not its content | `t_usage_guards` (docker shim log empty) |
| 10 | Freeze checks: in a real run, an existing job-lock dir or a running container labelled with the compose project (`MOVE_FREEZE_PROJECT`, default `stoktok`) exits 1 before the dump. In a dry run both only warn | `t_freeze` |
| 11 | `--verify-only` (re-run verification, no writes): exit 0 on an unchanged target, exit 1 naming the table after the harness changes one target row | `t_verify_only` |
| 12 | Target preflight prints `current_database`, `current_user` and `server_version_num`. It refuses a superuser login and a server below 170000 | `t_dry_run_happy` (output contains the three); superuser refusal by reading the code (the CI superuser password does not pass the password-file guard) |
| 13 | bash 3.2: no `mapfile`/`readarray`, `declare -A`, `${x,,}`/`${x^^}`, `|&`, `&>>`, `;;&`, `local -n`, `coproc`, `sed -i`, `sed -z`, `grep -P`, `readlink -f`, `date -d`, and no `"${arr[@]}"` of a possibly empty array under `set -u`. The script and the harness both pass `bash -n` under `bash:3.2` | `t_static` (grep list + `docker run --rm bash:3.2 bash -n`); `pnpm check:deploy-env` (its `bash -n scripts/*.sh` loop) |
| 14 | `docs/deploy.md` has a "Data move script (STK-091)" reference section (usage, env names without values, modes, outputs, exit codes, what it never does). The Shared Postgres step 3 points to it and to the A2b runbook ticket | Read the doc; `pnpm check:deploy-env` OK (env table untouched) |
| 15 | Nothing in the diff touches Supabase, the deployment repo, `.env.example` or the env table; no secret is committed | `git diff --stat main...` lists only the files below |
| 16 | `typecheck`, `lint`, `test`, `test:db`, `db:check`, `check:deploy-env`, `check:service-key`, `test:move` green (CI) | CI run on the PR |

## Ming verification after merge
- The A2b dry run: OrbStack containers can reach the Supabase session pooler (`aws-0-<region>.pooler.supabase.com:5432`, `sslmode=require`, user `postgres.<ref>`); the source major; the FK order of the real data-only restore; and the schema-check result against live Supabase (Studio drift).
- The `--worker-image` leg against a real release image (CI has no worker image in the `ci` job, so the harness uses `--skip-migrate`; see S4).
- A run under macOS `/bin/bash` 3.2 on the Mac (CI checks syntax under bash 3.2 and greps for 4.x features, but runs the script under bash 5).

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `scripts/db-migrate-from-supabase.sh` | Create (Approach §1–§9) | Ticket scope |
| `scripts/test-db-migrate-from-supabase.sh` | Create: the harness and all `t_*` cases | AC 1–13 (S7) |
| `scripts/test-fixtures/move-source-data.sql` | Create: seed rows for all 17 tables (fixture rules in Tests) | Harness source data |
| `package.json` | Add `"test:move": "bash scripts/test-db-migrate-from-supabase.sh"` | S7 |
| `.github/workflows/ci.yml` | New step after `pnpm db:check`: `- run: pnpm test:move` with `env: MOVE_TEST_URL: postgresql://postgres:postgres@localhost:5432/postgres` | AC 16 |
| `docs/deploy.md` | New section "Data move script (STK-091)" after "Shared Postgres (STK-084)"; step 3 of that section: "Cutover (STK-094): the data move (`scripts/db-migrate-from-supabase.sh`, below) and the first Postgres release; the step-by-step runbook arrives with STK-096." | AC 14 |

No other files. Do not change `.env.example` or the env-list table (the script's `MOVE_*` names are operator inputs on the Mac, not app env). Do not touch `scripts/schema-diff.sh`, `db-check.sh`, `deploy/`, anything under `supabase/`, or `/home/user/deployment`.

## Tests to write
All tests are in `scripts/test-db-migrate-from-supabase.sh`, run by `pnpm test:move`.

**Harness setup**
- `MOVE_TEST_URL` is validated like `DB_CHECK_URL` (localhost/127.0.0.1 only; reuse db-check's regex). The harness refuses if any of its own role or database names exist.
- It creates:
  - login roles `stoktok_mvsrc_<pid>` and `stoktok_mvdst_<pid>`, with random hex passwords prefixed `SENTINELsrc`/`SENTINELdst` (made with `od`, as in db-check);
  - source database `stoktok_mvsrc_<pid>`, owned by the source role, with the baseline applied as that role via host `psql --single-transaction`, then the fixture applied;
  - target database `stoktok_scratch_mv<pid>`, owned by the target role and migrated by `pnpm --filter @stoktok/worker job migrate` with `STOKTOK_DATABASE_URL` in env only (the same runner as the image).
- It then runs `alter database <src> set default_transaction_read_only = on`.
- Common script env: `PG_CLIENT_IMAGE=postgres:17`, `MOVE_SRC_NETWORK=host`, `MOVE_DST_NETWORK=host`, `MOVE_SRC_HOST=localhost`, `MOVE_SRC_SSLMODE=disable`, `MOVE_DST_HOST=localhost`, `MOVE_DST_USER=<dst role>`, `MOVE_DST_PWFILE=<harness tmp file>`, `--work-dir <harness tmp>`, `MOVE_JOB_LOCK=<harness tmp>/lock`, `MOVE_FREEZE_PROJECT=stoktok_mvtest_<pid>`.
- A `docker` shim first on `PATH` appends its argv to a log and then execs the real docker by absolute path.
- Cleanup on EXIT drops the databases (`with (force)`), the roles, any labelled test container, and the tmp dirs.

**Fixture rules** (`move-source-data.sql`): every table except `signals` gets at least 2 rows. It includes:
- Vietnamese diacritics (`'Công ty Cổ phần Sữa Việt Nam'`);
- NULLs in nullable columns;
- timestamptz values at UTC+7 midnight boundaries;
- jsonb and array columns where the table has them;
- `ai_summaries.usage_id` referencing `ai_usage` (FK order);
- one `ai_keys` row (valid shape);
- `data_gaps`: insert 3 rows, delete the highest id (sequence `last_value` > max);
- `news`: one row inserted `overriding system value` with id 100 (sequence behind max);
- `signals`: left empty (uncalled sequence);
- `settings`: id 1.

All values must satisfy the baseline CHECKs.

| Test (file › name) | Covers |
|---|---|
| `t_static` › grep the script and the harness for the bash-4/GNU list in AC 13; `docker run --rm -v "$ROOT/scripts:/s:ro" bash:3.2 bash -n /s/<file>` for both; the script contains no `set -x` | AC 13 |
| `t_usage_guards` › the bad targets of AC 9, `--dry-run --target stoktok`, unknown flag, `--force` without `--confirm` → exit 2; sslmode disable with `MOVE_SRC_HOST=db.example.invalid` → exit 2; password file `"short"` → exit 1 with the path in stderr and not the content; docker shim log empty for all | AC 6 (part), 9 |
| `t_schema_migrations_mismatch` › (a) an unmigrated scratch target with `--skip-migrate` → exit 1 "schema_migrations"; (b) the harness (superuser) changes the baseline row's checksum → exit 1; no dump file created; then restore the row | AC 7 |
| `t_dry_run_happy` › with the job-lock dir present (warning expected): exit 0; output has `current_database`, `current_user`, `server_version_num`, "schema check: no unexpected differences", "bumped" for `news`. Independent oracle per table (host psql, both sides): `count(*)` and `md5(string_agg(x::text, E'\n' order by x::text collate "C"))` equal for the 16 moved tables. Target `ai_keys` = 0. `pg_sequences` on target: `data_gaps` `last_value` = source (not max), `news` ≥ 100, `signals` uncalled. Source fingerprint unchanged. No dump file left in the work dir; work dir mode 700 (`find -maxdepth 0 -perm 700`). `assert_no_leak` | AC 1, 2, 3, 4, 10 (dry-run warn), 12 |
| `t_verify_only` › `--verify-only` → exit 0; the harness updates one `watchlist` row on the target → exit 1 naming `watchlist`; revert → exit 0 | AC 11 |
| `t_refuse_non_empty` › real mode on the now-filled target → exit 1 with a row count; the target oracle is unchanged | AC 5 |
| `t_force` › `--force --confirm wrongname` → exit 2; `--force --confirm <target>` → exit 0, oracle equal again; `schema_migrations` row (version, checksum, applied_at) unchanged | AC 6 |
| `t_freeze` › real mode: (a) lock dir present → exit 1 before the dump (no dump file); (b) `docker run -d --rm --label com.docker.compose.project=$MOVE_FREEZE_PROJECT postgres:17 sleep 120` → exit 1; the container is removed | AC 10 |
| `t_schema_drift` › a second source db with `alter table public.watchlist add column note text` on a fresh empty scratch target: (a) `--dry-run` → exit 1, output has the schema diff naming `watchlist`; (b) real mode without `--schema-check` → exit 1 at restore; target row count 0; `assert_no_leak` after the failures; pgpass dir gone | AC 3, 8 |

## Approach
CLI (exit 0 ok, 1 failure, 2 usage):
```
db-migrate-from-supabase.sh --target <db> (--worker-image <ref> | --skip-migrate)
                            [--dry-run] [--schema-check] [--force --confirm <db>]
                            [--keep-dump] [--verify-only] [--work-dir <dir>]
```
Environment variables (names only; no values in any file):
- Source: `MOVE_SRC_HOST`, `MOVE_SRC_PORT` (5432), `MOVE_SRC_USER`, `MOVE_SRC_DB` (`postgres`), `MOVE_SRC_SSLMODE` (`require`), `MOVE_SRC_PGPASSWORD` (optional, else a prompt).
- Target: `MOVE_DST_HOST` (`postgres`), `MOVE_DST_PORT` (5432), `MOVE_DST_USER` (`stoktok`, must match `^stoktok[a-z0-9_]*$`), `MOVE_DST_PWFILE` (`$HOME/srv/postgres/secrets/apps/stoktok.password`).
- Containers and freeze checks: `MOVE_SRC_NETWORK` (`bridge`), `MOVE_DST_NETWORK` (`db`), `PG_CLIENT_IMAGE`, `MOVE_JOB_LOCK` (`/tmp/stoktok-jobs.lock`), `MOVE_FREEZE_PROJECT` (`stoktok`).
- Work dir default: `$HOME/srv/backups/stoktok-cutover`.

Steps:
1. **Guards before any connection.** `set -euo pipefail`; unset `PGHOST PGHOSTADDR PGPORT PGSERVICE PGSERVICEFILE PGDATABASE PGUSER PGOPTIONS PGPASSWORD PGPASSFILE` (db-check precedent). Parse args with a `while/case` loop and validate names with `[[ =~ ]]` (S5). `MOVE_SRC_HOST` must match `^[A-Za-z0-9.-]+$`. sslmode must be one of `require|verify-ca|verify-full`; `disable`/`prefer` are allowed only for `localhost`/`127.0.0.1`. Ports must be numeric. The password file must exist and its single line must match `^[A-Za-z0-9_-]{16,}$` (deploy guard); `read -r` it into a variable, and on error name the file, never the content. Check `docker` is present.
2. **Freeze checks** (data-engineer rec. 1 and 5): `[ -d "$MOVE_JOB_LOCK" ]`, and `docker ps -q --filter "label=com.docker.compose.project=$MOVE_FREEZE_PROJECT"` must be empty. In a real run this is an error; in a dry run, a warning. `--verify-only` skips them.
3. **Secrets dir.** `umask 077; SECRETS="$(mktemp -d)"`; trap removes it. Write pgpass lines for the source and the target (escaped). Create the work dir with `mkdir -p` under umask 077 and check `find "$WORK" -maxdepth 0 -perm 700`.
4. **Preflight.** Target (`dst_psql`): print `current_database()`, `current_user`, `server_version_num`. Refuse if `rolsuper`, if below 170000, or if `current_database()` differs from `--target`. Source (`src_ro`): `server_version_num`. Client: `pg_dump --version` major 17 and ≥ the source major.
5. **Schema.** Build the expected list (S4). With `--worker-image`: compare the image's list with the checkout's, then run `STOKTOK_DATABASE_URL="postgres://$DST_USER:$pw@$DST_HOST:$DST_PORT/$TARGET" docker run --rm --network "$MOVE_DST_NETWORK" -e STOKTOK_DATABASE_URL "$IMG" migrate` (the image entrypoint is `node dist/cli.js`), and unset the variable after. Then assert `schema_migrations` equals the expected set (both `--worker-image` and `--skip-migrate`).
6. **Empty or force.** Get the table list from `pg_tables where schemaname = 'public' and tablename <> 'schema_migrations'`; every name must match `^[a-z_][a-z0-9_]*$`. Sum of `count(*)` > 0 → refuse (exit 1), unless `--force --confirm <same db>`, which runs one `begin; truncate <list> restart identity; commit;`. `--verify-only` skips steps 5's migrate, 6, 7, 8 and 9 and jumps to 10–11 (step 5's assertion still runs).
7. **Schema check** (dry run always; real run only with `--schema-check`). Dump the source schema (`src_dump`, schema-only) and the target schema (`dst_dump`) into the work dir, normalise (S6) and `diff -u` them. Save the diff to `$WORK/schema-check.diff` (DDL only, no data) and print it. Dry run: remember the result for the final verdict. Real run: print "informational" and continue.
8. **Dump and TOC.** `pg_dump -Fc --data-only --schema=public --no-owner --no-privileges --exclude-table=public.ai_keys --exclude-table=public.schema_migrations -f /work/<name>.dump` over the source network; no `--inserts`. The name is `stoktok-supabase-<UTC yyyymmdd-HHMMSS>.dump`. `pg_restore -l` (network none): the set of `TABLE DATA public <t>` names must equal the target table list minus `ai_keys` (named diff on failure, before touching the target).
9. **Restore.** `pg_restore --data-only --single-transaction --no-owner --no-privileges -d <target>` as the target role over the target network, then `ANALYZE` (DB consult §1, §6).
10. **Sequences** (DB consult §4). Find identity columns from `pg_attribute.attidentity <> ''` (expect 6) and resolve each sequence with `pg_get_serial_sequence`. Compare `seq|last_value|is_called` from `pg_sequences` on both sides; a mismatch is an error. Then per sequence, if the table has rows and (`last_value` is null or < `max(col)`), run `setval(seq, max(col), true)` and print "bumped <seq> to <n>". Never lower a sequence. Empty tables are left alone.
11. **Verify** (DB consult §6). From the source (`src_ro`), take per table the `quote_ident` column list in `ordinal_position` order and the primary-key column list. Fail if a table has no pk or a name does not match the identifier regex. Generate one SQL text and run it on both sides in one session that first runs `set TimeZone='UTC'; set DateStyle='ISO, YMD'; set IntervalStyle='postgres'; set extra_float_digits=1; set bytea_output='hex'; set statement_timeout=0;`. Per table it outputs `t|count|md5(coalesce(string_agg(md5(ROW(<cols>)::text), '' order by (ROW(<pk>)::text) collate "C"), ''))`. Write `verify-source.txt` and `verify-target.txt` to the work dir (names, counts and hashes only), and `diff` them; a mismatch is exit 1 naming the tables, with the hint "writers may be running; re-run with --verify-only". Assert target `ai_keys` has 0 rows.
12. **End.** Print a summary (tables, rows, sequences bumped, schema check result). Dry run: delete the dump unless `--keep-dump`, remind the operator to drop the scratch database, and exit 1 if the schema check found differences. Real run: keep the dump; print its path and "delete it when the 14-day rollback window closes (STK-095)".
13. **Output hygiene.** Never `set -x`. Never echo pgpass content, the URL or the password. Every container's stderr passes through, but libpq and pg_dump messages do not contain the password (pgpass). On error, print the step name.
14. **Harness and CI** as in Tests. The `package.json` script, then the CI step after `db:check`.
15. **Docs.** Add the "Data move script (STK-091)" section: purpose (one-time move Supabase → shared Postgres, read-only on Supabase); usage block; env names table (outside the `env-list` markers, with no backticked `| `NAME`` rows that the env-list parser would read; use a bullet list); modes and what each does; outputs (work dir, mode 700, `verify-*.txt`, `schema-check.diff`, the dump and its deletion at day +14; the dump is unencrypted financial data and is not offsite-synced); exit codes; "never writes to Supabase, never applies migrations there"; and that the full runbook is STK-096. Also edit step 3 of the Shared Postgres section.

Rules:
- R1, R2, R5, R9 and R10: not applicable.
- **R3:** the URL exists only in a shell variable and an inherited env for the worker image. Passwords are never on argv, in container env (pgpass) or in kept files. The harness proves this with sentinels.
- **R7:** only the files listed.
- **R8:** `test:move` covers the script. No `packages/core` change.
- Legacy-reference guard (`packages/db/src/legacy-reference-guard.test.ts`): `scripts/` is not on its allowlist, so neither new script may contain the old migration path text (`supabase` followed by a slash and `migrations` or `rollback`).

## Specialist input used
- **database-optimizer:**
  - §1 (two legs, pg17 image, `--entrypoint`, discrete libpq vars, session pooler and `require`, restore as `stoktok`): adopted. The pgpass mount replaces inherited `-e PGPASSWORD` (S2).
  - §2 (migrate from the candidate image, exact `schema_migrations` assertion): adopted with S4.
  - §3 (exclusions, TOC check, `ai_keys` 0 rows): adopted.
  - §4 (keep the dump's sequence state, bump only if behind, compare pairs): adopted.
  - §5 (catalog row count, force as an explicit TRUNCATE, allow-list, preflight prints): adopted. The superuser `exec` fallback is not adopted (S3: always as the app role).
  - §6 (pinned settings, per-row md5, `COLLATE "C"`, source column list, ANALYZE): adopted.
  - §7 (version rules): adopted.
  - §9 (cutover dir outside the backup tree, mode 700, delete after the window): adopted for the script defaults. Backup and restore-test steps go to the A2b runbook.
  - §11 (schema check): adopted with D4 and S6.
  - §8, §10, §12: no action here (already in A1).
- **data-engineer:**
  - rec. 5 (verify `ai_usage`/`ai_summaries`, no writers, lock check): adopted, since the md5 covers every table.
  - rec. 1–4 and 6 (freeze order, re-enabling jobs, first-run checks, AI ledger, smoke list): passed to A2b (runbook).
- **software-architect:**
  - R7 (no argv, no `--inserts`, FK order found in the dry run, delete the plaintext dump): adopted. The harness fixture also exercises FK order.
  - F9 (restore inside the postgres container): rejected in favour of DB consult §1, which proves the app credential path and needs no superuser.
  - R2, R3 and R8 (cutover order, rollback per stage, release review): passed to A2b.

## Assumptions
- **Read-only source access (S1):** the orchestrator's "only read-only `pg_dump`" is read as "only read-only access". The script also runs SELECTs in `READ ONLY` transactions for counts, md5, versions and sequences, which the consults require. If Ming wants strictly `pg_dump` only, step 11 loses its source side and can only compare the dump against the target, so freeze violations would go undetected. That would be a REWORK of step 11 only.
- The Mac has `docker` (OrbStack), `shasum`, `awk`, `find` and `mktemp`. The script runs from a checkout of the release tag (A2b runbook).
- `pgvector/pgvector:pg17-trixie` and the worker image accept `--user <uid>:<gid>`. pg client binaries need no passwd entry when `PGUSER` is set; the worker image runs `node` as any uid with read access to `/app`. If OrbStack bind-mount ownership differs, the dry run shows it.
- `--network host` works on the GitHub ubuntu runner (Linux) and in OrbStack, for local `pnpm test:move`.
- CI image pulls: `postgres:17` is already present for the service; `bash:3.2` is small.
- No other open ticket edits `ci.yml`, `package.json` or `docs/deploy.md` (STK-090, STK-092 to STK-095 are BACKLOG). `src/App.tsx` does not exist here.
- The cutover runbook in the ticket title is not in this slice (Split proposal). STK-094 must not start before A2b is done.

## Blocking questions
None.

## Split proposal
Including tests, the ticket comes to about 850 changed lines: script ~380, harness ~280, fixture ~60, runbook ~130. That is more than one implement/review cycle, so it is split:

| Slice | Ticket | Content | Depends on |
|---|---|---|---|
| **A2a** | **STK-091 (this plan)** | `scripts/db-migrate-from-supabase.sh`, `scripts/test-db-migrate-from-supabase.sh`, fixture, `test:move` and CI step, "Data move script" reference section in `docs/deploy.md` | STK-084 (merged) |
| A2b | STK-096 (to create) | Cutover runbook in `docs/deploy.md`:<br>• **Prerequisites:** B and C merged; STK-090 or Ming's waiver; the release PR open with the STK-094 compose commit, not merged; worker image digest from its `release.env`; checkout of the tag; Supabase pooler host, user and password, never stored in a file.<br>• **Dry run:** `create database stoktok_scratch owner stoktok` via superuser `exec`; script `--dry-run`; read the `schema-check.diff`; `drop database ... with (force)`.<br>• **Freeze:** weekend or after Friday 21:00; check the lock; `launchctl bootout` and verify; `docker compose -p stoktok stop stoktok-web`; no reboot, no deploys; note 3–4 dashboard totals.<br>• **Move:** script against `stoktok`.<br>• **Release:** merge the release PR (backup → migrate "up to date" → `/readyz`); copy the pre-migration `last/stoktok-*.dump` out of retention.<br>• **Verify:** data-engineer smoke list and first-run checks (gaps query, counts unchanged after a second run).<br>• **AI keys:** new keys, revoke the old ones, grep `ai_keyring_invalid`.<br>• **Rollback per stage:** architect R3, with Ming's 14-day manual re-entry; prefer fixing forward.<br>• **Day +14:** STK-095, delete the cutover dump; Supabase `public` tables stay as a read-only archive (Ming's action, nothing scripted). | STK-091 |

Follow-up for the orchestrator: create STK-096 and add it to STK-094's "Depends on".
