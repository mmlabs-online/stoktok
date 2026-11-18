Status: READY

# Plan — STK-096: Cutover runbook in docs/deploy.md (STK-091 split A2b)

One implement/review cycle. The ticket has three parts:
- **Part A:** the runbook, a new section of `docs/deploy.md`.
- **Part B:** the STK-091 follow-ups that Ming carried to this ticket. These are small script and harness changes: F4 digest pin, optional F7 `verify-full`, the `t_column_pipe_newline` fix, the extra-table case, and the docs:124 wording.
- **Part C:** `work/ming-todo.md` "Move to the shared Postgres", updated so it agrees with the runbook.

The cutover release itself is STK-094: the `migrate` service, the `/readyz` health check and cutting the release. This plan does not contain it. The runbook names it as a precondition.

## Spec summary
- ticket.md Goal: "Write the full cutover runbook in `docs/deploy.md`, using `scripts/db-migrate-from-supabase.sh` from STK-091: dry run on `stoktok_scratch` (schema check mandatory, D4), freeze web and scheduler on a weekend or outside the 18:30/21:00 Mon–Fri job slots, move, release, verification and smoke list, AI ledger checks and new provider keys (revoke the old ones), rollback per stage, day +14 contract (STK-095)."
- ticket.md AC: "The runbook covers every stage above with commands that match the STK-091 script's real flags and messages." "Nothing in it applies a migration to or writes into the Supabase project; no secret in the doc." "Checks green (typecheck, lint, test, test:db, db:check, check:deploy-env, test:move)."
- ticket.md notes 2026-11-17 (Ming, via STK-091): "rotate the Supabase DB password after a successful cutover; pin `PG_CLIENT_IMAGE` by digest (STK-091 security F4); optional TLS `verify-full` with a mounted Supabase root cert (F7). … Ming verifies the dry run against live Supabase (pooler reachability from OrbStack, schema-check result, bind-mount permissions), the `--worker-image` leg with a real release image, and one run under macOS `/bin/bash` 3.2."
- ticket.md notes 2026-11-17 (orchestrator): "make `t_column_pipe_newline` a real regression test (rename to `"a|b<LF>c|d"` …; add a case with an extra source table `zzz`; make it self-contained instead of depending on `t_column_pipe`); reword docs/deploy.md:118 so 'read-only transaction' clearly refers to the verify step; runbook: run the script inside `tmux`/`screen`; keep `~/srv/backups/stoktok-cutover` out of any offsite/Time Machine sync."
- ticket.md notes 2026-11-18: "STK-091, STK-092 and STK-093 are merged (deployment#88, #90); their deploy runs were queued on the offline self-hosted runner — the runbook states them as preconditions. … the runbook must match [work/ming-todo.md]."
- STK-084 ticket, Ming 2026-11-17: "(2) Rollback window 14 days: `SUPABASE_*` stay in the env file during the window; if a rollback is needed, data written after the cutover is re-entered by hand; prefer fixing forward. (3) After the window, keep the Supabase `public` tables as a read-only archive; delete only the old Vault AI keys (`stoktok_ai_key_%`)."
- STK-091 ticket, Ming 2026-11-17: "(2) Read-only SELECTs on Supabase inside read-only transactions are approved (plan S1). (3) Rotate the Supabase DB password after a successful cutover — a step in the STK-096 runbook."
- STK-093 ticket, Ming 2026-11-18: "The `stoktok` GitHub environment already allows deployments from `main` only."
- STK-084 plan D4: schema check "Mandatory in the dry run, informational (non-blocking) at the real cutover." STK-084 plan split row D (STK-094): "web health check `/readyz` … add the compose commit to the release PR; Ming runs the … runbook".
- CLAUDE.md R3 (DB credentials server-only, never printed), R7, R8, R10.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | `docs/deploy.md` has a section `## Cutover runbook (STK-096)` with these stages, in this order: 0 Preconditions, 1 Dry run, 2 Freeze, 3 Move, 4 Release, 5 Verify and smoke, 6 AI keys, 7 After a successful cutover, 8 Rollback per stage, 9 Day +14 | Read the section and check every stage named in the ticket Goal is there |
| 2 | Every script call in the runbook uses only real flags (`--target`, `--worker-image`, `--skip-migrate`, `--dry-run`, `--schema-check`, `--force --confirm`, `--keep-dump`, `--verify-only`, `--work-dir`) and real env names (`MOVE_*`, `PG_CLIENT_IMAGE`, the new `MOVE_SRC_SSLROOTCERT`). Every message the runbook quotes exists in the script | For each quoted string, `grep -F '<string>' scripts/db-migrate-from-supabase.sh` finds it: `dry run OK`, `dry run FAIL: schema check found differences`, `schema check: no unexpected differences`, `schema_migrations matches db/migrations`, `identity sequences`, `ai_keys is empty on the target`, `move OK`, `dump kept:`, `FAILED at step:`, `freeze the apps first`, `is not empty`, `verification failed; writers may be running`, `the worker image migrations differ from this checkout`. Also `grep -oE -- '--[a-z-]+' ` on the new section lists only those flags plus docker/psql/launchctl/git flags |
| 3 | Dry run: scratch DB created as the `stoktok` owner on the shared Postgres; script run with `--dry-run --target stoktok_scratch --worker-image <release worker image>` under `/bin/bash` inside `tmux`/`screen`; schema check result read; scratch DB dropped `with (force)`; what to do with a dump or pgpass left by a failed or killed run | Read stage 1 |
| 4 | Freeze: a window on a weekend, or Friday after the 21:00 run has finished; never inside 18:30–19:30 or 21:00–22:00 Mon–Fri, and not near 02:00/03:30 (backups). Totals noted first. `launchctl bootout` plus a check. Lock and running-container check. `stoktok-web` stopped and checked. No reboot, no OrbStack restart, no deployment-repo merge during the freeze | Read stage 2 |
| 5 | Move: a real run against `stoktok` with the same worker image, `--schema-check` informational; the expected output lines; the recorded numbers (tables, rows, sequences bumped, dump path); failure handling (`--verify-only`, `--force --confirm stoktok`) | Read stage 3 |
| 6 | Release: merge the STK-094 release PR (precondition: it carries the `migrate` service and the `/readyz` health check). The runbook names the expected steps of the deploy run: backup, migrate printing `up to date`, deploy healthy on `/readyz`, publish, then `agent` reinstalling the scheduler, which ends the freeze. It then copies the pre-migration `last/stoktok-*.dump` into the cutover dir | Read stage 4; `grep -n "'up to date'" packages/db/src/pg/migrate.ts` confirms the text |
| 7 | Verify and smoke: the data-engineer smoke list (consult rec. 6) and the first-run checks (rec. 3). This includes: `/healthz` version; `/readyz` 200 inside the container and an Access redirect from outside; login; totals match; a write and its deletion; settings; job dry run, then real runs twice with counts unchanged; an open-gaps query; logs; scheduler loaded; next-day pg-backup. Every DB query runs in a read-only transaction on the **shared Postgres** | Read stage 5; every `pgro` call is a SELECT |
| 8 | AI keys and ledger: the ledger baseline is recorded after the move. New keys are entered on Settings, and one AI action produces an `ai_usage` id above the baseline. Old env-secret keys are replaced or removed before the old keys are revoked. `ai_keyring_invalid` is grepped in the web logs and the job logs, both on cutover day and the next day | Read stage 6 |
| 9 | After a successful cutover: rotate the Supabase DB password (dashboard; it affects neither v0.2.1 nor Auth); delete any leftover `tmp.*/pgpass`; clear shell history if `MOVE_SRC_PGPASSWORD` was exported | Read stage 7 |
| 10 | Rollback per stage, one row each: dry run, freeze, move, release (migrate failed / unhealthy auto-restore / `restore-unpushed`), inside the 14-day window, after day +14. Each row says what is lost: data written after the cutover is re-entered by hand. Fix-forward is preferred. Re-cutover after a rollback needs `--force --confirm stoktok` | Read stage 8 |
| 11 | Day +14 points to STK-095: the contract PR; delete `STOKTOK_SUPABASE_URL` and `STOKTOK_SUPABASE_SERVICE_ROLE_KEY` (Authen keys stay); delete only the Vault `stoktok_ai_key_%` rows; Supabase `public` tables stay as a read-only archive; delete `~/srv/backups/stoktok-cutover/`; rollback to v0.2.1 is impossible after this | Read stage 9 |
| 12 | `~/srv/backups/stoktok-cutover` is created as mode 700 and excluded from Time Machine (`tmutil addexclusion`, then `tmutil isexcluded`). The runbook states the offsite sync covers only `~/srv/backups/postgres/{daily,weekly,monthly}` | Read stage 0 |
| 13 | Nothing in the runbook writes to or migrates the Supabase project. Supabase is reached only by the script (read-only). No manual Supabase query is needed. The only Supabase actions are Ming's dashboard steps (DB password reset after the cutover; day +14 per STK-095) | Grep the new section with `grep -niE '\b(insert|update|delete|truncate|drop|alter|create)\b'`. Every hit must be prose, or `create/drop database stoktok_scratch` on the shared Postgres, or STK-095's Vault deletion described in prose only. Also confirm `--worker-image` migrate targets `MOVE_DST_*` |
| 14 | No secret in the docs or the to-do list: no key, password, URL with credentials, real project ref or real digest; placeholders only (`<ref>`, `<region>`, `<digest>`, `vX.Y.Z`) | Each of these prints nothing on `docs/deploy.md work/ming-todo.md`: `grep -nE 'sb_secret_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{20}|[A-Za-z0-9+/]{43}=|sha256:[0-9a-f]{64}|postgres(ql)?://[^<$ "]+:[^<$ "@]+@'`. `grep -n 'MOVE_SRC_PGPASSWORD=' docs/deploy.md` shows no value |
| 15 | F4: for a source host other than `localhost`/`127.0.0.1`, the script refuses (exit 2, before any docker call) a `PG_CLIENT_IMAGE` not pinned as `<repo>@sha256:<64 hex>`. The runbook gives the command to read the digest of the image the shared Postgres runs | `pnpm test:move` › `t_usage_guards` (new asserts) and `t_client_image_pin`; read stage 0 |
| 16 | F7 (optional): `MOVE_SRC_SSLROOTCERT=<absolute path>` is mounted read-only only into **source** legs, with `PGSSLROOTCERT`. The script refuses (exit 2) a cert without `MOVE_SRC_SSLMODE` `verify-ca`/`verify-full`, `verify-*` without a cert, a missing file, a path outside `^/[A-Za-z0-9._/-]+$`, and a file without `-----BEGIN CERTIFICATE-----`. The runbook explains it as optional and gives a fallback order | `t_usage_guards` (new asserts); `t_sslrootcert` (mount only on source-leg argv lines); read stage 0/1 |
| 17 | `t_column_pipe_newline` renames to `"a|b<LF>c|d"` and is self-contained (it runs alone: `pnpm test:move t_column_pipe_newline` from a fresh harness). A new `t_extra_source_table` asserts exit 1 and `not a target data table`. Both fail against the attempt-2 script (ba1f2b5) | Run `bash scripts/test-db-migrate-from-supabase.sh t_column_pipe_newline` and `… t_extra_source_table` alone. Mutation: remove script lines 256–257 (`list_re` checks) → `t_column_pipe_newline` FAILS; remove 258–262 (membership) → `t_extra_source_table` FAILS |
| 18 | docs:124 reworded: the host/DB-name guards and the read-only verify are separate sentences ("The verify step reads the target in a read-only transaction too.") | Read the "Data move script (STK-091)" section |
| 19 | The "Data move script" reference lists `MOVE_SRC_SSLROOTCERT` and the digest rule. "Shared Postgres (STK-084)" intro and step 3 point to the runbook section instead of "arrives with STK-096". The "Roll back" section adds one line pointing to the runbook during the 14-day window | Read the doc |
| 20 | `work/ming-todo.md` "Move to the shared Postgres": the Cutover block has one checkbox per runbook stage 0–7, in the same order and with the same names. Day +14 matches stage 9. The wrong path `~/srv/apps/stoktok/run-job.sh` becomes `/Users/mingming/stoktok/current/run-job.sh` | Compare side by side; `grep -n 'srv/apps' work/ming-todo.md` prints nothing |
| 21 | `check:deploy-env` still OK: exactly one `/Users/<name>`, no new `/Library/LaunchDaemons/` path, env table untouched | `pnpm check:deploy-env` |
| 22 | Checks green: typecheck, lint, test, test:db, db:check, check:deploy-env, test:move | Run them; CI on the PR (test:move with PG 17 and real docker rests on CI, as in STK-091) |

## Ming verification after merge
These cannot be checked by the reviewer. They are the runbook's own dry-run checks, and they are mirrored in `work/ming-todo.md`:
- The dry run against live Supabase:
  - the session pooler is reachable from OrbStack with `sslmode=require` (and `verify-full`/`verify-ca` if a root cert is used);
  - the source major version;
  - the FK order of the real data-only restore;
  - the schema-check result (Studio drift);
  - pgpass and work-dir bind-mount permissions with `--user`.
- The `--worker-image` leg with the real release image (image migration list and `migrate`).
- One run under macOS `/bin/bash` 3.2 inside `tmux`/`screen`.
- That `docker compose -p stoktok stop|start stoktok-web` works with the project name alone on the Mac (see Assumptions; the fallback `docker stop`/`docker start` is in the runbook).

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `docs/deploy.md` | New section `## Cutover runbook (STK-096)` after "Data move script (STK-091)" (Approach A). Edits: line 95 ("cut no release before the cutover runbook exists (STK-091, STK-094)" → the runbook exists, see that section, the release is STK-094); step 3 at line 103 → points to the section; line 108 "the ordered runbook … is STK-096" → points to the section; env bullets at 115–117: add `MOVE_SRC_SSLROOTCERT` and the digest rule for `PG_CLIENT_IMAGE`; line 124: split the read-only sentence (AC 18); "Roll back" section: one line pointing to the runbook during the window | AC 1–14, 18, 19 |
| `scripts/db-migrate-from-supabase.sh` | F4 digest guard; F7 `MOVE_SRC_SSLROOTCERT` guard and source-only mount; header comment lists both (Approach B) | Ming's note (F4, F7) |
| `scripts/test-db-migrate-from-supabase.sh` | New asserts in `t_usage_guards`; new `t_client_image_pin`, `t_sslrootcert`, `t_extra_source_table`; `t_column_pipe_newline` rewritten self-contained; `t_column_pipe` made self-contained with the same helper; `ALL` list extended | Ming's/orchestrator's notes; AC 15–17 |
| `work/ming-todo.md` | "Move to the shared Postgres" section aligned with the runbook (Approach C) | Ticket note 2026-11-18; AC 20 |
| `work/tickets/STK-096/impl-log.md` | Implementer log | Workflow |

No other files. Do not edit `.env.example` or the env-list table (the `MOVE_*` names are operator inputs), `deploy/`, `scripts/check-deploy-env.sh`, anything under `supabase/`, `/home/user/deployment`, CLAUDE.md, or other tickets' plans.

## Tests to write
All in `scripts/test-db-migrate-from-supabase.sh` (`pnpm test:move`). New code is bash 3.2-safe: no arrays expanded under `set -u` when they may be empty; `t_static`'s grep list must stay clean.

| Test (file › name) | Covers |
|---|---|
| `t_usage_guards` › (new) `XENV="MOVE_SRC_HOST=db.example.invalid MOVE_SRC_SSLMODE=require"` with `PG_CLIENT_IMAGE=postgres:17` → exit 2, output has `pinned by digest` | AC 15 |
| `t_usage_guards` › (new) `MOVE_SRC_SSLROOTCERT=$TMP/ca.pem` (valid PEM header) with `MOVE_SRC_SSLMODE=disable` (local) → exit 2. `MOVE_SRC_SSLMODE=verify-full` with no `MOVE_SRC_SSLROOTCERT` → exit 2. A non-existent cert path → exit 2. A relative path → exit 2. A file without `-----BEGIN CERTIFICATE-----` → exit 2 | AC 16 |
| `t_usage_guards` › the existing "no docker call for any guard" assert still runs last and stays green, so all new guards fire before docker | AC 15, 16 |
| `t_client_image_pin` › `digest="$("$REAL_DOCKER" image inspect -f '{{index .RepoDigests 0}}' postgres:17)"`. If it is empty, print `skip: no repo digest for postgres:17` and return (the assert is still counted in CI, where the image is pulled). Run with `PG_CLIENT_IMAGE=$digest`, `MOVE_SRC_HOST=db.example.invalid`, `MOVE_SRC_SSLMODE=require`, `--target $DST3_DB --skip-migrate --dry-run`. Expect: exit 1 (not 2); output lacks `pinned by digest`; output has `FAILED at step: preflight` (the source host does not resolve); the docker log shows the digest image in a `run` line; `assert_no_leak` | AC 15 |
| `t_sslrootcert` › write `$TMP/ca.pem` with BEGIN/END CERTIFICATE lines and filler. Run `MOVE_SRC_SSLMODE=verify-full MOVE_SRC_SSLROOTCERT=$TMP/ca.pem` against the local source (`--target $DST3_DB --skip-migrate --dry-run`). Expect: exit 1 at preflight (the local server has no valid TLS); every docker-log line containing `/certs/root.crt` also contains `-U $SRC_ROLE`; no line containing `-U $DST_ROLE` contains `/certs/root.crt` or `PGSSLROOTCERT`; at least one source line has both `:/certs/root.crt:ro` and `PGSSLROOTCERT=/certs/root.crt`; `assert_no_leak` | AC 16 |
| `t_column_pipe` › uses the new helper `drift_set_last_col 'n|ote'` instead of assuming the column is `note`; asserts unchanged | AC 17 (self-contained) |
| `t_column_pipe_newline` › `drift_set_last_col "a|b<newline>c|d"` (a real newline), `--verify-only` against `$DST_DB` → exit 1, `out_has "unexpected source column list"`, no verify SQL needed beyond that; `assert_no_leak`. Runs alone from a fresh harness | AC 17 |
| `t_extra_source_table` › `drift_set_last_col note`; on the drift DB (session `set default_transaction_read_only = off`) `create table public.zzz (id int primary key)`; `--verify-only` against `$DST_DB` with `MOVE_SRC_DB=$DRIFT_DB` → exit 1, `out_has "not a target data table"`; then `drop table public.zzz`; `assert_no_leak` | AC 17 |
| Helper `drift_set_last_col <name>` › one `su_db "$DRIFT_DB"` call with `set default_transaction_read_only = off` and a `do $$ … $$` block. The block selects the last non-dropped `attnum > 0` column of `public.watchlist` (the drift column added at setup) and, if its name differs, runs `execute format('alter table public.watchlist rename column %I to %I', old, new)`. The new name is passed safely: use a psql variable with `:'newname'` in a `set_config`/`current_setting` pair, or build it with `E'…'`/`chr(10)` for the newline case. Never interpolate an unescaped `'` | AC 17 |
| Mutation proofs (recorded in impl-log, not committed): remove script lines 256–257 → `t_column_pipe_newline` FAILS; remove 258–262 → `t_extra_source_table` FAILS; remove the F4 guard → the new `t_usage_guards` digest assert FAILS; make the cert mount apply to every leg → `t_sslrootcert` FAILS | AC 15–17 |

`ALL` becomes: `t_usage_guards t_static t_schema_migrations_mismatch t_dry_run_happy t_verify_only t_refuse_non_empty t_force t_freeze t_schema_drift t_column_pipe t_column_pipe_newline t_extra_source_table t_client_image_pin t_sslrootcert`. Run `t_client_image_pin` and `t_sslrootcert` against `$DST3_DB`, the unmigrated target: preflight fails on the source before any write, and `t_schema_migrations_mismatch` has already used it read-only.

## Approach

### B. Script (do first; the runbook quotes its messages)
In section 1 (guards), after the sslmode `case`:
1. **F4:**
   ```
   SRC_LOCAL=0; case "$SRC_HOST" in localhost|127.0.0.1) SRC_LOCAL=1 ;; esac
   if [ "$SRC_LOCAL" = 0 ] && ! [[ "$PG_CLIENT_IMAGE" =~ ^[A-Za-z0-9._/:-]+@sha256:[0-9a-f]{64}$ ]]; then
     usage_err "PG_CLIENT_IMAGE must be pinned by digest (<repo>@sha256:<64 hex>) for a remote source; see docs/deploy.md Cutover runbook"
   fi
   ```
   Reuse `SRC_LOCAL` in the existing sslmode `case` only if that keeps the code shorter; behaviour must not change.
2. **F7:**
   - `SRC_CERT="${MOVE_SRC_SSLROOTCERT:-}"`.
   - If `SRC_CERT` is set: the path must match `^/[A-Za-z0-9._/-]+$` (no `:`, which would break `-v`), else `usage_err`. It must be `-f` and `-r`, else `usage_err "MOVE_SRC_SSLROOTCERT $SRC_CERT is missing or unreadable"`. `grep -q -- '-----BEGIN CERTIFICATE-----' "$SRC_CERT"`, else `usage_err "… is not a PEM certificate"`. `SRC_SSL` must be `verify-ca|verify-full`, else `usage_err "MOVE_SRC_SSLROOTCERT needs MOVE_SRC_SSLMODE verify-ca or verify-full"`.
   - If `SRC_CERT` is empty and `SRC_SSL` is `verify-ca|verify-full`: `usage_err "MOVE_SRC_SSLMODE=$SRC_SSL needs MOVE_SRC_SSLROOTCERT (the Supabase root certificate)"`.
   - All of this runs before the password-file read and before any docker call.
3. **Source-only mount:** give `pg_run` an optional cert mount without an empty-array expansion. Add a global `PG_CERT_CUR` (empty by default) and branch:
   ```
   if [ -n "$PG_CERT_CUR" ]; then docker run … -e PGSSLROOTCERT=/certs/root.crt -v "$PG_CERT_CUR:/certs/root.crt:ro" …; else docker run …; fi
   ```
   Keep one shared tail of arguments so the two branches cannot drift. Alternatively build the extra args as two plain strings guarded by `[ -n ]`. `src_dump` and `src_ro` set `PG_CERT_CUR="$SRC_CERT"`. Every target function and the `none`-network calls set `PG_CERT_CUR=""`, alongside where they set `PG_SSL_CUR` today (lines 183, 187, 188, 207, 344). The cert content is never printed.
4. Header comment: add one line for F4/F7 and point to the runbook section.
5. No other behaviour change. The existing guards' order and messages stay byte-identical, because the runbook and the existing tests quote them.

### Harness
As in Tests. `drift_set_last_col` replaces the two inline renames. Keep `XENV` usage as today (`env $XENV`). A cert path in `XENV` must contain no spaces (`$TMP` comes from `mktemp -d`, which has none).

### A. Runbook (`docs/deploy.md`, new section after "Data move script (STK-091)")
Style: as in the rest of the file. Short numbered steps, commands in backticks or short fenced blocks, names only and never values.
- Docker runs as `mingming`, and `docker inspect` only with `-f`.
- Paths: `/Users/mingming/stoktok/current/run-job.sh`, `/Users/mingming/stoktok/logs`, `~/srv/postgres/compose.yml`, `~/srv/backups/...`.
- Keep the check:deploy-env invariants. The only `/Users/<name>` is `mingming`. No new `/Library/LaunchDaemons/` text. Do not write `gh-runner`. No backticked `| \`NAME\`` table rows.

Intro (2–3 lines): the runbook is one-time. Production runs v0.2.1 on Supabase until stage 4. Rollback window: 14 days, re-enter data by hand, prefer fixing forward (Ming, 2026-11-17). Supabase is only read, by the script; the Supabase `public` tables stay as a read-only archive.

Define once, for read-only checks on the **shared Postgres** (the stoktok DB, superuser over the container's local socket, read-only transaction):
```
pgro() { printf '%s\n' 'begin transaction read only;' "$1;" 'rollback;' | docker compose -p postgres -f ~/srv/postgres/compose.yml exec -T postgres psql -U postgres -d stoktok -X -q -A -t -v ON_ERROR_STOP=1; }
```

**0. Preconditions** (all must hold; tick in `work/ming-todo.md`):
1. `macbook-runner` online. `deploy-postgres` #9 (STK-092) and `deploy-stoktok` #10 (STK-093, expand) are green, and their ming-todo checks are ticked: first backup, restore-test, 8 env names, web on `db web`, `eod-prices --dry-run`.
2. STK-090 merged, or waived by Ming (ADR 0010).
3. STK-094 done:
   - the release `vX.Y.Z` is cut;
   - its deployment PR `release/stoktok-vX.Y.Z` is **open, not merged**;
   - the PR changes `apps/stoktok/release.env` plus the STK-094 commit to `apps/stoktok/compose.yml` (`migrate` service, `/readyz` health check);
   - `git log v0.2.1..vX.Y.Z` has been skimmed (architect R8), and no unrelated merges went in after it.
4. Worker image: `STOKTOK_WORKER_IMAGE` from that PR's `release.env` (digest-pinned). `docker pull <it>` succeeds on the Mac.
5. Checkout of the tag, outside the runner's work dir: `git clone --branch vX.Y.Z --depth 1 <stoktok repo> ~/stoktok-cutover-src`, or `git checkout vX.Y.Z` in an existing clone. `git describe --tags --exact-match` prints `vX.Y.Z`. The script compares the image's migrations with this checkout ("the worker image migrations differ from this checkout (wrong tag checked out?)").
6. Client image pinned (F4):
   - `docker image inspect -f '{{join .RepoDigests "\n"}}' pgvector/pgvector:pg17-trixie` shows the `pgvector/pgvector@sha256:<digest>` line.
   - Check that it is the image the shared Postgres runs: `docker inspect -f '{{.Image}}' $(docker compose -p postgres -f ~/srv/postgres/compose.yml ps -q postgres)` equals `docker image inspect -f '{{.Id}}' pgvector/pgvector:pg17-trixie`.
   - `export PG_CLIENT_IMAGE=pgvector/pgvector@sha256:<digest>`. Without the pin, the script exits 2 with "pinned by digest".
7. Supabase source details, kept in the password manager and never in a file:
   - session pooler host `aws-0-<region>.pooler.supabase.com`, port 5432, user `postgres.<ref>`, database `postgres`;
   - the DB password (reset it in the dashboard if unknown; that does not affect the API keys).
   - Export only the non-secret names (`MOVE_SRC_HOST`, `MOVE_SRC_USER`). Let the script prompt for the password. Do not export `MOVE_SRC_PGPASSWORD`, which would put it in shell history.
8. Optional TLS verification (F7):
   - Download the Supabase root certificate (Project Settings → Database → SSL configuration) to an absolute path without spaces, e.g. `~/srv/backups/stoktok-cutover/supabase-ca.crt`.
   - `export MOVE_SRC_SSLROOTCERT=<that path> MOVE_SRC_SSLMODE=verify-full`.
   - If the dry run fails on the certificate, try `verify-ca` with the same cert. If that fails too, unset both (default `require`) and note it.
9. Work dir: `mkdir -p -m 700 ~/srv/backups/stoktok-cutover`, then `tmutil addexclusion ~/srv/backups/stoktok-cutover` and `tmutil isexcluded ~/srv/backups/stoktok-cutover` (must say excluded). The offsite sync copies only `~/srv/backups/postgres/{daily,weekly,monthly}` (deployment `ops/backup/RESTORE.md`). Never add `~/srv/backups` to a sync.
10. Session: run every script call inside `tmux new -s cutover` (or `screen`). An SSH drop then cannot HUP a real run halfway. Call the script as `/bin/bash scripts/db-migrate-from-supabase.sh …` from the tag checkout (macOS bash 3.2).

**1. Dry run** (any day before cutover, ideally the same week; production keeps running):
1. `docker compose -p postgres -f ~/srv/postgres/compose.yml exec -T postgres psql -U postgres -c "create database stoktok_scratch owner stoktok"` (shared Postgres only).
2. `/bin/bash scripts/db-migrate-from-supabase.sh --dry-run --target stoktok_scratch --worker-image "$WORKER_IMAGE"`. This also tests the `--worker-image` leg. Freeze problems only warn here.
3. Expected: `schema_migrations matches db/migrations`, `schema check: no unexpected differences`, `sequences: 6 identity sequences, N bumped`, `verified N tables, M rows; ai_keys is empty on the target`, `dry run OK`. Note N, M and the bumped sequences.
4. `dry run FAIL: schema check found differences` → read `~/srv/backups/stoktok-cutover/schema-check.diff` (DDL only) and send it to the agent. Do not cut over.
5. Any other `FAILED at step: <step>` → send the output (it holds no passwords) to the agent.
6. Drop: `… exec -T postgres psql -U postgres -c "drop database stoktok_scratch with (force)"`.
7. Leftovers:
   - A dry run deletes its dump (also on failure) unless `--keep-dump`. After `--keep-dump` or a killed run, delete `~/srv/backups/stoktok-cutover/stoktok-supabase-*.dump`.
   - After a killed run, also delete any `tmp.*/pgpass` under `$TMPDIR` of that shell (`echo $TMPDIR`; on macOS `/var/folders/.../T/`). See "Data move script".

**2. Freeze** (cutover day):
1. Window: Saturday or Sunday daytime, or Friday after the 21:00 run has finished (`tail /Users/mingming/stoktok/logs/schedule.log`). Never 18:30–19:30 or 21:00–22:00 Mon–Fri. Stay away from 02:00 (pg-backup) and 03:30 (offsite sync).
2. Before stopping anything, note 3–4 dashboard totals (holdings value, P&L, number of transactions), the fee rate on Settings and the AI spend if Settings shows it (a screenshot is fine).
3. Scheduler: `launchctl bootout gui/$(id -u)/online.mmlabs.stoktok.jobs`. Then `launchctl print gui/$(id -u)/online.mmlabs.stoktok.jobs` must fail.
4. No job running: `test ! -d /tmp/stoktok-jobs.lock`. `docker ps --filter label=com.docker.compose.project=stoktok` lists only `stoktok-web`. If a job runs, wait for it; do not kill it.
5. Web: `docker compose -p stoktok stop stoktok-web` (fallback: `docker stop <container name from docker ps>`). Then `docker ps --filter label=com.docker.compose.project=stoktok` prints no container. The site shows a Cloudflare 502, which is expected.
6. Until stage 4 is finished: no reboot, no OrbStack restart, and no deployment-repo merge. Any merge under `apps/stoktok/` runs `deploy-stoktok`, which restarts web and reloads the scheduler.

**3. Move:**
1. `/bin/bash scripts/db-migrate-from-supabase.sh --target stoktok --worker-image "$WORKER_IMAGE" --schema-check`. The schema check is informational at the cutover (D4). The freeze checks block: "freeze the apps first" means go back to stage 2.
2. Expected: the preflight line `current_database=stoktok current_user=stoktok`, `schema_migrations matches db/migrations`, `sequences: 6 identity sequences, …`, `verified N tables, M rows; ai_keys is empty on the target` (N as in the dry run, M ≥ the dry run), `dump kept: …` and `move OK`. Note the dump path.
3. Ledger baseline: `pgro "select coalesce(max(id),0) || '|' || count(*) from ai_usage"`. Note it.
4. On failure:
   - `verification failed; writers may be running` → check the freeze, then `/bin/bash scripts/db-migrate-from-supabase.sh --target stoktok --verify-only`.
   - A failure after the restore leaves `stoktok` non-empty. A retry then needs `--force --confirm stoktok` (truncates every table except `schema_migrations`). The script says so: "is not empty".
   - Not solvable now → rollback row "move".

**4. Release:**
1. Merge the STK-094 release PR `release/stoktok-vX.Y.Z`. Watch `deploy-stoktok`:
   - `pull` (migrate service found);
   - `backup` (pre-migration dump of every DB);
   - `migrate` printing `up to date` (the move already applied the schema; anything else, e.g. "applied …", is unexpected → report);
   - `deploy` healthy on `/readyz` within 120 s;
   - `publish`;
   - `agent` reinstalls the scheduler because the bootout unloaded it. This ends the freeze.
   - The PR comment says `deployed: … vX.Y.Z … healthy`, with no "Scheduler NOT installed" and no "Database is ahead".
2. Copy the pre-migration dump out of the 24 h `last/` retention: `cp "$(ls -t ~/srv/backups/postgres/last/stoktok-*.dump | head -n 1)" ~/srv/backups/stoktok-cutover/ && chmod 600 ~/srv/backups/stoktok-cutover/stoktok-*.dump`.
3. Failure → rollback row "release".

**5. Verify and smoke** (before the next job slot):
1. `docker compose -p stoktok ps`: web healthy, new start time.
2. `docker compose -p stoktok exec stoktok-web node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>r.text()).then(console.log)"` shows `vX.Y.Z`. The same with `/readyz` shows `{"status":"ok"}`.
3. `curl -sI https://<APP_HOSTNAME>/readyz` without a session gets the Access redirect (302/403), not 200. `/readyz` has no Access bypass.
4. Log in at `https://<APP_HOSTNAME>/login` (Auth is still Supabase). The dashboard totals, the transaction count and the fee rate equal the stage 2 notes.
5. One write: add a test transaction (or change and restore a setting), check it shows, then delete it.
6. Scheduler: `launchctl print gui/$(id -u)/online.mmlabs.stoktok.jobs` succeeds.
7. Jobs:
   - Run `/Users/mingming/stoktok/current/run-job.sh eod-prices --dry-run` (exit 0).
   - Note `pgro "select (select count(*) from prices_daily) || '|' || (select count(*) from financials) || '|' || (select count(*) from signals) || '|' || (select count(*) from data_gaps) || '|' || (select count(*) from news)"`.
   - Note `pgro "select data_type || '|' || count(*) from data_gaps where resolved_at is null group by data_type order by 1"`.
   - Run `run-job.sh eod-prices`, `financials`, `signals`. Then run `eod-prices` and `signals` again: the counts after the second run equal those after the first.
   - Open gaps: new rows only for days the source really lacks. Downtime does not create gaps.
   - `tail /Users/mingming/stoktok/logs/eod-prices.log` shows `exit=0` and `vX.Y.Z`.
   - `news` is not scheduled: run `run-job.sh news` only to check it.
8. Logs: `docker compose -p stoktok logs stoktok-web 2>&1 | grep -c ai_keyring_invalid` prints 0. `grep -l 'ai_keyring_invalid\|lock timeout' /Users/mingming/stoktok/logs/*.log` prints nothing.
9. Next morning: `ls -l ~/srv/backups/postgres/daily/stoktok-*.dump` shows today's dump, larger than the empty-DB one. The 03:30 offsite sync is healthy.

The script has already compared every table's count and ordered md5 with Supabase, including `ai_usage` and `ai_summaries`. The migrated AI spend and `ai_summaries.usage_id` are therefore equal by construction, and no manual query on Supabase is needed.

**6. AI keys:**
1. Issue new keys at Anthropic and Google AI Studio.
2. Enter them on Settings. Saving works because the master key is set.
3. Trigger one AI action. `pgro "select max(id) from ai_usage"` is above the stage 3 baseline. The Settings spend equals the old spend plus the new row.
4. If the `stoktok` environment has `STOKTOK_ANTHROPIC_API_KEY` or `STOKTOK_GOOGLE_AI_API_KEY` holding an old key (env fallback, ADR 0011): replace or delete it, then run `deploy-stoktok` via `workflow_dispatch` on `main` (the environment allows `main` only).
5. Revoke the old keys at both providers.
6. Repeat the `ai_keyring_invalid` greps of stage 5.8 now and the next day: 0 and nothing.

**7. After a successful cutover:**
1. Reset the Supabase database password (dashboard, Project Settings → Database) and store the new one in the password manager.
   - Nothing deployed uses it: v0.2.1 and Auth use the API keys, which this does not change.
   - A re-run of the script after a rollback needs the new password.
2. `ls -d $TMPDIR/tmp.*` shows no leftover `pgpass` dir.
3. If `MOVE_SRC_PGPASSWORD` was exported despite stage 0, remove it from the shell history.
4. Exit the `tmux` session.

**8. Rollback per stage** (table: stage | do | what is lost):
- **Dry run:** drop `stoktok_scratch`. Production unchanged.
- **Freeze (before the move finished):**
  - `docker compose -p stoktok start stoktok-web` (fallback `docker start`);
  - `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/online.mmlabs.stoktok.jobs.plist`, then check with `launchctl print`;
  - leave the release PR unmerged.
  - Nothing lost. Before the next attempt `stoktok` must be empty: use `--force --confirm stoktok`.
- **Move failed:** as Freeze. Supabase is untouched (read-only).
- **Release, `migrate` failed:** web stays stopped (deploy skipped) and the scheduler stays unloaded. Start web and bootstrap the agent as in Freeze; v0.2.1 runs on Supabase. Do not merge again; report. Nothing lost.
- **Release, web unhealthy:**
  - The workflow restores v0.2.1 (`SUPABASE_*` are still in the env file) and reinstalls the agent.
  - With D5 the result is `restore-unpushed`: revert the release PR's merge commit in a deployment PR and merge it.
  - Nothing lost (no writes reached Postgres).
- **Inside the 14 days (problem found later):**
  - Prefer fixing forward with a new release.
  - Only if that is impossible, revert the release PR's merge commit in a deployment PR. v0.2.1 comes back on Supabase data as of the freeze.
  - **Everything written after the cutover is lost there and must be re-entered by hand:** transactions, settings, Settings AI keys (on v0.2.1 AI stays off, because the Vault keys are revoked). Market data refetches within 20 trading days.
  - A later re-cutover repeats stages 2–4 with `--force --confirm stoktok`.
- **After day +14:** no data-store rollback; restore only from pg-backup dumps (deployment `ops/backup/RESTORE.md`).

**9. Day +14 (STK-095):** in this order (STK-095 holds the details):
1. Merge the contract PR. It stops writing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
2. Delete `STOKTOK_SUPABASE_URL` and `STOKTOK_SUPABASE_SERVICE_ROLE_KEY` from the environment. The `STOKTOK_AUTHEN_*` keys stay.
3. Delete only the Vault `stoktok_ai_key_%` rows.
4. Keep the Supabase `public` tables as a read-only archive.
5. `rm -rf ~/srv/backups/stoktok-cutover` (the move dump, the pre-migration copy, the verify files, the optional CA file).

From then on a rollback to v0.2.1 is impossible.

### C. `work/ming-todo.md`
Rewrite the "Cutover (STK-096 runbook, then STK-094)" block as one checkbox per runbook stage 0–7. Use the stage names, and for each give a one-line summary and the key check. Fold the existing items into the matching stage: pooler reachability, schema check, bind mounts, bash 3.2, tmux, worker-image leg, AI keys, password rotation. Keep "Day +14" aligned with stage 9 (add "contract PR merged first"). Fix `~/srv/apps/stoktok/run-job.sh` → `/Users/mingming/stoktok/current/run-job.sh` in the expand block. Do not tick anything.

### Rules
- R3: no value of any secret in the docs. The runbook never prints the env file or a password, uses `docker inspect` only with `-f`, and prompts for the source password.
- R7: only the listed files. STK-094's code (compose commit, `/readyz` health check, drafts) is not touched.
- R8: the script change is covered by `test:move`. No `packages/core` change.
- R10 and the hard limit: Supabase is read only through `src_dump`/`src_ro`. The runbook adds no Supabase query.
- R1, R2, R4, R5, R6 and R9: not applicable.

## Specialist input used
No new consult (ticket note 2026-11-18). Used from STK-084's consults:
- **data-engineer:** rec. 1 (freeze order) adopted as stage 2. Rec. 2 (re-enabling jobs) adopted: the deploy's `agent` step re-bootstraps the scheduler, and stage 5 checks it. Rec. 3 (first-run checks) and rec. 6 (smoke list) adopted as stage 5. Rec. 4 (AI ledger):
  - adopted as stage 6, with the baseline taken on the target after the move;
  - the Supabase-side "before" SELECTs are dropped, because the script's per-table md5 already proves `ai_usage`/`ai_summaries` are identical;
  - the Supabase-pausing risk is accepted (spec §9).
- **database-optimizer:** §5 (scratch DB create/drop `with (force)`) adopted. §9 (immediate backup, copy `last/` out of retention, dump outside the backup tree, delete after the window) adopted in stages 4 and 9. §1 (session pooler, `require`) adopted in stage 0. §11 (schema check) adopted per D4.
- **software-architect:** R2 (order) adopted. R3 (rollback per stage) adopted, with Ming's 14-day manual re-entry. R7 (prompt instead of an env password, delete the dump) adopted. R8 (review `git log v0.2.1..`) adopted as a precondition. Open Q5 (read-only announcement): stopping web is the freeze, nothing more.
- **STK-091 security review:**
  - F4 adopted, as a script guard plus a runbook step.
  - F7 adopted as an optional env var with a fallback order.
  - Risks adopted: Time Machine exclusion, no sync, tmux, password rotation.
  - The docs:118 wording (now line 124) is adopted.
- **STK-091 review attempt 3:** Issue 1 (pipe-newline test, extra table) adopted. Its follow-up "say what to do with a dump left by a failed dry run" is adopted in stage 1.7.

## Assumptions
- **F4 design:** the digest pin is enforced only for a non-local source, mirroring the existing sslmode exemption, so CI and the harness keep `postgres:17`. The default value stays the tag. A real run without the pin exits 2 with a message that points to the runbook. Ming asked for a "pin", not for a specific default; a hard-coded digest in the repo would go stale with every server image update.
- **F7 tightening:** `verify-ca`/`verify-full` without `MOVE_SRC_SSLROOTCERT` now exits 2. Before, it failed at connect, because the container has no default root cert. Whether Supabase's session pooler passes `verify-full` against the downloaded root cert is unknown. The runbook therefore gives the fallback order, and Ming finds out in the dry run.
- **Compose by project name:** `docker compose -p stoktok stop|start stoktok-web` without `-f` works on the Mac's compose v2 (`ps`/`exec`/`logs` are already used this way in this doc). The runbook gives a `docker stop`/`docker start` fallback.
- **`pgro`:** `psql -U postgres` over the container's local socket needs no password (the docker image's default local trust; `add-app-db.sh` and RESTORE.md use the same `exec postgres psql -U postgres` shape). It reads the shared Postgres only, in read-only transactions.
- **Supabase dashboard actions:** the DB password reset (stage 7) and STK-095's Vault deletion are Ming's own decisions and Ming's dashboard actions. They are not data writes by the runbook or the script. The ticket's "nothing writes into the Supabase project" is read as covering the runbook's commands and the script.
- The `last/` file name pattern `stoktok-YYYYMMDD-HHMMSS.dump` and the offsite scope come from deployment `ops/backup/RESTORE.md:14-18`.
- No other open ticket edits these files. STK-094 (BACKLOG) will later edit the deployment drafts, not these files. STK-097 (BACKLOG) edits `check-deploy-env.sh` and the live workflow, not `docs/deploy.md`'s runbook. `src/App.tsx` does not exist in this repo.
- The STK-091 plan.md:136 wording (F1) stays as recorded by the orchestrator. It is not edited here.

## Blocking questions
None.

## Split proposal
None. Size estimate:
- runbook about 160 doc lines;
- the "Data move script", "Shared Postgres" and "Roll back" edits about 10;
- script about 30;
- harness about 70;
- ming-todo about 15.

That is about 285 changed lines, so one cycle. If review shows the script/harness part is the risk, the fallback split is STK-098 = Part B (F4/F7 and the test fixes), with this ticket keeping the runbook. That split is not needed now.

Follow-ups (R7, not in this diff):
- CLAUDE.md "Current state" ("Production still runs the Supabase-backed release until the shared-Postgres cutover") must change after the cutover. That belongs to STK-094 or STK-095.
- `news`, `financial-statements` and `resolve-holiday-gaps` are not scheduled (existing follow-up).
