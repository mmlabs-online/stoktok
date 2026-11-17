## Attempt 1 — 2026-11-17
Verdict: PASS

Reviewed `git diff origin/main...HEAD` at 9d92786. Code commit a06e5c6; the later commits only add `work/` bookkeeping and `security-review.md`. Scope is slice A2a per plan.md. The cutover runbook is STK-096 and is not expected here.

### Checks (run by reviewer)
- typecheck: green (`pnpm typecheck`, exit 0).
- lint: green (`pnpm lint`, exit 0).
- test: green. core 834, sources 35, ai 184, db 158 (includes the legacy-reference guard), worker 310, web 359. This matches impl-log.
- test:db: green on a throwaway local PG 16 (port 55439). 26 files, 148 tests. Matches impl-log.
- db:check: `db:check OK` (same server).
- check:deploy-env: `OK: deploy env lists consistent`.
- `bash -n` on both scripts (bash 5): ok.
- test:move, run locally by the reviewer: `test:move OK`, 74 assertions, all 9 cases.
  - I used my own docker stand-in (independent of the implementer's), first on PATH. It maps `/work` and `/secrets` to host PG 16 tools and reports pg_dump 17. It emulates `ps --filter label`, `run -d --label` and `rm -f` with a state file, so t_freeze's container leg ran. It runs `bash:3.2 bash -n` as host bash 5 `-n`.
  - The run used a temp mirror of the repo (symlinks, with `scripts/` copied). In the copy, only the `-ge 170000` target guard (script :191) was relaxed to 160000. The committed script is unchanged.
  - Cleanup left no `stoktok*` databases or roles behind.
  - This reproduces the implementer's 7/9 claim and extends it to 9/9, with the caveats above.
- **CI evidence** (the orchestrator should confirm it independently). The `ci` job of PR #71 at 9d92786 concluded `success`. Its log shows every step green: typecheck, lint, test, test:db, `check:service-key` (`OK: no secret or AI SDK material in client bundle`), check:deploy-env, `db:check OK`, and `pnpm test:move`, which printed `test:move OK` with every assertion `ok`.
  - That run used real docker, a `postgres:17` service (so the PG 17 server guard and PG 17 pg_dump normalisation were exercised), `--network host`, `--user` uid with pgpass bind mounts, a real labelled container for t_freeze, and `bash:3.2 bash -n` for both scripts.
  - The following evidence rests on CI alone: the bash 3.2 syntax check, the real-docker freeze leg, the PG 17 server and client paths, and the `check:service-key` result (impl-log says it fails locally on the base tree; I did not re-run it here).

### Acceptance criteria (plan.md verification table)
- [x] 1 Happy dry run. Evidence: `t_dry_run_happy`. The independent oracle covers 17 tables; source `ai_keys` has 1 row and the target has 0; exit 0; "dry run OK". Green locally and in CI.
- [x] 2 Source never written.
  - The source DB has `default_transaction_read_only = on` (harness :83), and the source fingerprint is unchanged (`t_dry_run_happy`).
  - `SRC_HOST` appears only in guards (:73-74, :89), the tty prompt (:108), the pgpass line (:151) and `src_dump`/`src_ro` (:168-173).
  - `src_ro` wraps every statement in `set default_transaction_read_only = on; begin ... read only; ... ; rollback;`.
- [x] 3 No secret on argv, in output or in leftover files. Evidence: `assert_no_leak` in `t_dry_run_happy` and in both `t_schema_drift` failures (sentinels absent from output, docker argv log and work dir; pgpass dir `$TMP/sd` empty). `MOVE_SRC_PGPASSWORD` is unset before any child process (:105).
- [x] 4 Sequences. Evidence: `t_dry_run_happy`.
  - `data_gaps` equals the source, which is above max.
  - `news` is ≥ 100 and printed as "bumped".
  - `signals` stays uncalled.
  - Source and target `pg_sequences.last_value` are compared before any bump (:326-329). Uncalled shows as null, which encodes `is_called`. A bump only raises a sequence (`last -lt mx`, :339).
- [x] 5 Non-empty target refused using the catalog table list. Evidence: `t_refuse_non_empty` (exit 1, "not empty", oracle unchanged, no dump).
- [x] 6 Force. Evidence: `t_force`. Wrong confirm gives exit 2. The forced run gives exit 0 and the oracle equals the source again. `schema_migrations` is unchanged. There is a single `truncate ... restart identity` (:272).
- [x] 7 schema_migrations mismatch. Evidence: `t_schema_migrations_mismatch` (unmigrated target and changed checksum both exit 1, no dump).
- [x] 8 Schema check D4. Evidence: `t_schema_drift`. The dry run exits 1 with a diff naming `watchlist`. The real run exits 1 at restore and the target stays empty (single transaction).
- [x] 9 Allow-list and guards before docker. Evidence: `t_usage_guards`. The docker shim log stays empty. The malformed password file is named and its content is not printed.
- [x] 10 Freeze. Evidence: `t_freeze`. Lock dir and labelled container both exit 1 with no dump in a real run; the dry run only warns (`t_dry_run_happy`). The real-docker container leg is CI only.
- [x] 11 `--verify-only`. Evidence: `t_verify_only` (exit 0, then exit 1 naming `watchlist`, then exit 0).
- [x] 12 Preflight. The three values are printed (`t_dry_run_happy`). Superuser refusal at :190 and the <170000 refusal at :191 were verified by reading the code. The 170000 guard runs for real in CI (PG 17).
- [x] 13 bash 3.2.
  - The `t_static` grep list is clean (locally and in CI). `bash:3.2 bash -n` passes in CI only.
  - Manual read: no arrays in the script, no `;&`, no `${x,,}`, no `mapfile`. `<(...)`, `[[ =~ ]]`, `read -rs` and `${v// /}` all exist in 3.2.
  - BSD-compatible tools only: `find -maxdepth 0 -perm 700`, `sed -E`, `shasum`, plain awk.
- [x] 14 docs/deploy.md "Data move script (STK-091)" section is present. Shared Postgres step 3 points to it and to STK-096. check:deploy-env passes.
- [x] 15 Scope. Code files are exactly the plan's six. The other changed files are orchestrator bookkeeping that the plan requested (`work/backlog.md`, STK-091/094/096 tickets, plan, impl-log, security-review). Nothing touches `supabase/`, `.env.example`, the env table or the deployment repo. No secret is committed: the fixture's `ai_keys` row is filler bytes, and CI uses the throwaway `postgres:postgres` service.
- [x] 16 All checks green in CI (see above).
- [x] Ticket AC "Nothing applies a migration to the Supabase project". `migrate` targets only `DST_HOST`/`TARGET` (:209-210).

### Ming verification after merge (carry into the PR)
- The A2b dry run (STK-096) against live Supabase. It must cover:
  - OrbStack containers reaching the session pooler with `sslmode=require`
  - the source major version
  - the FK order of the real data-only restore
  - the schema-check result against Studio drift
  - pgpass and work-dir bind-mount permissions under OrbStack with `--user`
- The `--worker-image` leg (image migration listing plus `migrate`) against a real release image. It is untested in CI by design (S4), so `assert_no_leak` does not cover it either.
- One run under macOS `/bin/bash` 3.2 on the Mac. CI only checks syntax under 3.2.

### Issues
None blocking. No 🔴 or 🟡 issues against the plan.

On the security review's 🟡 findings, this is my independent read. The orchestrator decides whether to take any of them now.
- **F1 (URL in the migrate container env):** this is what plan S2 chose explicitly ("passed as an inherited `-e STOKTOK_DATABASE_URL`"). Plan line 136 contradicts S2, not the code. docs/deploy.md:112 is literally accurate. Not a defect against the plan; a one-line doc clarification would be fine.
- **F2 (HUP):** I checked bash 5: an untrapped SIGHUP still runs the EXIT trap (`rc=129`, trap ran), so the pgpass dir is removed. Not verified on bash 3.2. SIGKILL or power loss cannot be covered by any trap. Low.
- **F3 (target verify SQL in a read-write session):** identifiers come from `quote_ident`. Only a `|` or newline in a source column name could break the split. Low. A `dst_ro` wrapper would be cheap hardening.
- **F5 (failed dry run leaves the dump):** true. docs/deploy.md:110 says a dry run "deletes the dump unless `--keep-dump`", which holds only on the success and schema-diff paths. The work dir is mode 700. See Nits.

### Rules R1–R10
No violations found.
- R1, R2, R4, R5 and R9 are not applicable.
- R3: the DB URL exists only in a shell variable and inherited env for the migrate leg. Passwords are never on argv, and the pgpass file is removed on exit.
- R6: no server routes.
- R7: scope is clean.
- R8: no `packages/core` change; the script is covered by `test:move`.
- R10: no brokerage or Supabase writes.

### Nits (do not block)
- `scripts/db-migrate-from-supabase.sh:310-311`: the TOC check compares the DB-collation `order by tablename` (:222) with the host `sort` of the TOC names. Under en_US collation a future name pair like `price_z`/`pricea` would sort differently and give a false (fail-safe) mismatch. Today's 17 names sort identically. Use `LC_ALL=C sort` on both sides, or `order by tablename collate "C"`.
- `:202`: the expected checksum uses `tr -d '\r'`, while the runner (`packages/db/src/pg/migrate.ts:68-70`) only normalises `\r\n`. They diverge only for a lone `\r` in a migration file. A false mismatch fails safe.
- `:356`: a dry run that fails after the dump (at restore or verify) leaves the dump in the work dir despite the docs line "deletes the dump unless `--keep-dump`". Either delete it in `cleanup` when `DRY=1 && KEEP_DUMP=0`, or adjust the doc.
- docs/deploy.md:110: "differences make the verdict FAIL ... after the data move finished" does not hold for column drift, where the move itself fails at restore (as `t_schema_drift` shows). Wording only.
- `:330-347`: the plan says "expect 6" identity sequences, but `NSEQ` is printed and not asserted.
- `--verify-only` takes its table list from the source, so a table that exists only on the target is not reported (the full move's TOC check covers this).
- The dump is created with the container's umask (0644) inside the 700 work dir (security F5).

### Follow-ups (out of scope)
- STK-096 runbook: say what to do with a dump left by a failed dry run. Prefer the prompt over an exported `MOVE_SRC_PGPASSWORD`, which keeps the password out of shell history. Consider rotating the Supabase DB password after the cutover.
- Pin `PG_CLIENT_IMAGE` by digest (security F4). Add a host:port inequality guard between source and target (F6). Optionally support `verify-full` with a mounted Supabase CA (F7).
- Ming should confirm the plan's S1 reading: "read-only access" includes SELECTs in READ ONLY transactions, not strictly `pg_dump` only. The security review raises the same question. Without it, step 11 loses its source side.
