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

## Attempt 2 — 2026-11-17
Verdict: REWORK

Scope: Ming's note "after attempt 1 PASS" item 1 (security F1, F2, F3, F5, F6 and the listed nits). The rework commit is ba1f2b5. The current branch head is 072f5ce, which only adds `security-review.md` attempt 2, so the code is the same as in ba1f2b5.

### Checks (run by reviewer)
- typecheck: green (rc 0).
- lint: green (rc 0).
- test: green. core 834, sources 35, ai 184, db 158, worker 310, web 359. This matches impl-log.
- test:db, on a throwaway local PG 16 (127.0.0.1:55491): 26 files, 148 tests passed.
- db:check: `db:check OK`.
- check:deploy-env: `OK: deploy env lists consistent`.
- `bash -n` on both scripts (bash 5.2): ok.
- test:move, run locally by the reviewer: **10/10 cases, 83 assertions ok, `test:move OK`**, with MOVE_TEST_URL on `localhost`, the same as CI.
  - I used my own docker stand-in, first on PATH. It runs the host PG 16 tools, maps `/work` and `/secrets`, and reports pg_dump 17. It emulates `ps --filter label`, `run -d --label` and `rm -f` with a state file. It maps `bash:3.2 bash -n` to host bash `-n`.
  - The run used a temp mirror of the repo, with `scripts/` copied. In the copy, only the `-ge 170000` guard (:202) was relaxed to 160000. The harness was byte-identical and the committed script is unchanged.
  - A subset run with `127.0.0.1` (t_usage_guards, t_dry_run_happy, t_column_pipe; 41 ok) passed too, so both alias directions work.
  - No `stoktok*` databases or roles were left behind.
- Mutation checks, each reverted afterwards. Every new assertion fails when its fix is removed:
  - Removing the cleanup dump `rm` fails "a failed dry run leaves no dump".
  - Removing the line regex fails "says so". The exit is still 1, from a later SQL error.
  - Removing the host:port guard fails "target host:port equal…" and "no docker call for any guard".
  - Changing NSEQ to 7 fails "exit 0" and "dry run OK".
- HUP, by hand: I sent SIGHUP to the script during preflight, with a reachable target. Result: exit 1, `FAILED at step: preflight`, no other error, and the `$TMPDIR` pgpass dir was removed.
- **CI evidence** (GitHub REST API; the orchestrator should confirm). Job `ci` 134089356950 on PR #71 head 072f5ce concluded `success`. Every step was green: typecheck, lint, test, test:db, check:service-key (`OK: no secret or AI SDK material in client bundle`), check:deploy-env, db:check, and test:move (10 cases, 83 `ok`, `test:move OK`).
  - The `CHECK FAILED` lines in that log are db:check's own negative self-tests in the Postgres service log. They are not failures.
  - The `ci` run on d474423 was cancelled, superseded by 072f5ce.
  - **The following rest on CI alone:** the `127.0.0.1` target alias under real docker with `--network host` (it works: CI uses `localhost` for the source and `127.0.0.1` for the target), the real-container dump mode 600 (locally the dump is already 600 through `umask 077`, so the local assertion does not tell the two apart), bash 3.2 `-n`, the real-docker freeze leg, and the PG 17 server and client paths.

### Acceptance criteria (Ming's fix list for this attempt)
- [x] **F1 docs wording.** `docs/deploy.md:112` states that the migrate container gets the URL in `-e STOKTOK_DATABASE_URL` and that it is visible to `docker inspect`, like the worker. This matches script :220-221. plan.md:136 still says "never … in container env". See Issue 4.
- [x] **F2 HUP trap and leftover note.** `trap 'exit 129' HUP` is at :138, and the HUP test above passed. The docs note is at :112, but its location is wrong on macOS (Issue 3).
- [ ] **F3: target verify read-only and reject `|`/newline.** FAILED, see Issue 1.
  - The read-only part is done: `dst_ro` (:181-185) is used at :260.
  - The rejection can be bypassed.
- [x] **F5 dump mode and failed-dry-run cleanup.** `chmod 600` is at :325 and the cleanup is at :129. Evidence: the `t_force` mode assertion (CI) and `t_schema_drift` "a failed dry run leaves no dump" (local and CI, mutation-checked). There is a small gap for partial dumps in a real run (Issue 2).
- [x] **F6 host:port guard.** :82-84, a case-insensitive string check. Evidence: the `t_usage_guards` case (mutation-checked). It is lexical only (Issue 5).
- [x] **Nits.**
  - `collate "C"` (:233) and `LC_ALL=C sort` (:327).
  - Numeric `$mx` check (:355).
  - Assertion of 6 identity sequences (:365, mutation-checked).
  - Drift wording in docs:113.
- [x] **No regression.** All 9 attempt-1 cases are still green locally and in CI.
- [x] **Nothing is applied to Supabase; no secret is committed.** The diff touches only the script, harness, docs and impl-log. `assert_no_leak` is green in every case that has it.
- [x] **Repo checks green**: see above.

### Issues
#### Issue 1 — 🔴 blocker — F3 column-list rejection can be bypassed (Ming's fix list)
- **Where**: `scripts/db-migrate-from-supabase.sh:245-254`
- **Expected**: Ming asked to "reject `|`/newline in source column lists". No SQL built from a malformed source column list should be sent to either server.
- **Actual**: the regex is applied per line after the output is split on newlines.
  - A column name that contains both `|` and a newline yields two lines that each match `line_re`.
  - Reproduced: on a scratch copy of the harness (not committed), I renamed `watchlist.note` to `"a|b<LF>c|d"` on the drift source and ran `--verify-only`.
  - Both fragments passed the check, and the script sent the malformed SQL to the source: `ERROR: syntax error at or near "C" … ROW(…,"a)::text), '' order by (ROW(b)::text) collate "C"`, exit 1.
  - So the generated SQL still contains source-controlled, unbalanced quoted identifiers. The security re-review (`security-review.md` Attempt 2, F3) reaches the same conclusion.
  - Real-world risk is low: it needs DDL rights on Supabase, the SQL runs inside a read-only transaction, and no working injection has been shown. But this is one of the fixes Ming required before the PR, and it is not met.
- **Fix instruction**: after the `tpk` check (:253), add:
  - `[[ "$tcols" =~ ^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$ && "$tpk" =~ ^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$ ]] || fail "unexpected source column list (a name with | or a newline?)"`. All stoktok columns are lowercase snake_case, so `quote_ident` never quotes them.
  - `printf '%s\n' "$DATA_TABLES" | grep -qx -- "$tname" || fail "source table $tname is not a target table"`.
  - In the harness, add a case next to `t_column_pipe` that renames a source column to a name with `|` **and** a newline (for example `"a|b"$'\n'"c|d"`). Assert exit 1 and `out_has "unexpected source column list"`. Keep the existing `t_column_pipe`.

#### Issue 2 — 🟡 should-fix — a partial dump from a failed real run keeps the container's mode
- **Where**: `scripts/db-migrate-from-supabase.sh:323-325`
- **Expected**: the dump is never readable beyond the owner (F5).
- **Actual**: `chmod 600` runs only after `src_dump` succeeds.
  - If pg_dump fails partway in a real run, or in a `--keep-dump` dry run, the partial file stays at the container's default 0644. Cleanup deletes the dump only in a failed dry run without `--keep-dump`.
  - The work dir is 700, so the impact is small.
- **Fix instruction**: before :324, add `: > "$WORK/$DUMP"`. That creates the file as 0600 under the script's `umask 077`, and pg_dump runs as the same uid, so it keeps the mode. Keep :325 as a backstop.

#### Issue 3 — 🟡 should-fix — docs point to the wrong place for a leftover pgpass on macOS
- **Where**: `docs/deploy.md:112`, "check `$TMPDIR` (default `/tmp`)"
- **Expected**: the runbook names the place where `mktemp -d` actually created the dir. The script runs on Ming's Mac.
- **Actual**: on macOS, `$TMPDIR` is normally `/var/folders/…/T/`, so a reader who checks `/tmp` misses the file that holds both passwords.
- **Fix instruction**: reword to "check `$TMPDIR` of the shell that ran the script (`echo $TMPDIR`; on macOS usually `/var/folders/…/T/`, `/tmp` only when it is unset) for a leftover `tmp.*/pgpass` and delete that directory".

#### Issue 4 — 🟡 should-fix (orchestrator or planner, not the implementer) — plan.md still has the wrong F1 claim
- **Where**: `work/tickets/STK-091/plan.md:136`, "Passwords are never … in container env (pgpass)"
- **Expected**: Ming asked to "correct plan/docs wording" for F1.
- **Actual**: docs are corrected. plan.md is not, which impl-log:48-49 acknowledges because the implementer may not edit the plan.
- **Fix instruction**: the orchestrator or planner amends plan.md:136 to say the migrate container gets the URL in its env, visible to `docker inspect` for its lifetime (plan S2).

#### Issue 5 — 🟡 should-fix — the F6 guard is lexical only
- **Where**: `scripts/db-migrate-from-supabase.sh:82-84`, `docs/deploy.md:118`
- **Expected**: the target leg can never be the source (F6 "by construction").
- **Actual**: aliases get past the guard: `localhost`/`127.0.0.1`, a name and its IP, a trailing dot, `05432`. The harness relies on exactly this (:97). Ming's literal wording, a host:port comparison, is met.
- **Fix instruction**: in section 1, add `[ "$SRC_DB" != "$TARGET" ] || usage_err "the source database equals the target database; refusing"`.
  - Every write goes to `$TARGET`, and preflight asserts `current_database() = $TARGET`, so with this guard no write can reach the source database under any alias.
  - The harness still passes (`stoktok_mvsrc_*` ≠ `stoktok_scratch_mv*`). Add one `t_usage_guards` assertion (`XENV="MOVE_SRC_DB=$DST_DB"`, exit 2).
  - Change docs:118 to "refuses a target host:port string equal to the source's, and a target database name equal to the source's".

### Rules R1–R10
No violations found.
- R1, R2, R4, R5, R6 and R9 are not applicable.
- R3: passwords are not on argv, and the pgpass dir is removed on EXIT, INT, TERM and HUP. The migrate-leg env exposure is now documented.
- R7: only the script, harness, docs and impl-log changed, all in the plan's list.
- R8: no `packages/core` change; `test:move` covers the script.
- R10: nothing writes to Supabase.

### Nits (do not block)
- :267: the target `ai_keys` count still uses `dst_psql` (read-write session). It is a plain SELECT; `q_dst` via `dst_ro` would make the whole verify phase read-only.
- :357: `$last` is not checked as numeric the way `$mx` is. It comes from `pg_sequences.last_value::text`, so the risk is nil.
- The `t_force` mode-600 assertion cannot tell the two cases apart locally, because `umask 077` already gives 600. Only CI's real container (umask 022) proves the `chmod`.
- The HUP trap has no harness case; it was verified by hand above.

### Follow-ups (out of scope)
- F4 (pin `PG_CLIENT_IMAGE` by digest) and F7 (`verify-full` with a root cert) are in STK-096, as Ming decided.
- STK-096 runbook: run the real move inside `tmux`/`screen`, so an SSH drop does not HUP a real run halfway. Rotate the Supabase DB password after the cutover (Ming's note item 3).

## Attempt 3 — 2026-11-17
Verdict: PASS

Scope: the attempt-2 review items, all for the implementer: Issue 1 (F3 blocker), Issue 2 (F5 partial-dump mode), Issue 3 (`$TMPDIR` docs) and Issue 5 (F6 DB-name guard). Issue 4 (plan.md:136) belongs to the orchestrator and is recorded in ticket.md notes. The rework commit is 24a400e. Branch head 60c1abd adds only review.md. PR #71 head 396785f adds only `security-review.md` (GitHub compare: 1 file, +48), so the code is the same as in 24a400e.

### Checks (run by reviewer)
- typecheck: green (rc 0).
- lint: green (rc 0).
- test: green. core 834, sources 35, ai 184, db 158, worker 310, web 359. This matches impl-log.
- test:db, on a throwaway local PG 16 (127.0.0.1:55493): 26 files, 148 tests passed. The server was stopped and its data dir deleted afterwards.
- db:check: `db:check OK`.
- check:deploy-env: `OK: deploy env lists consistent`.
- `bash -n` on both scripts (bash 5.2): ok.
- test:move, run by the reviewer with the full harness: **all 11 cases, 90 `ok`, 0 FAIL, `test:move OK`**. MOVE_TEST_URL was on `localhost`.
  - I used my host docker stand-in from attempt 2, first on PATH. It runs PG 16 tools, maps `/work` and `/secrets`, reports pg_dump 17, emulates `ps`/`run -d`/`rm -f`, and maps `bash:3.2 -n` to host bash `-n`.
  - It ran against a temp mirror with `scripts/` copied. In the copy, only the `-ge 170000` guard (:203) was relaxed to 160000. The harness copy was byte-identical (`cmp`), and the committed scripts are untouched (`git status` clean).
  - No `stoktok*` databases or roles were left behind. No new `pgpass` file was left in `/tmp`.
- **F3 bypass reproduction, re-run.** I used a scratch harness copy (deleted afterwards, not committed) with `log_statement = 'all'` on the server. For each case I checked the server log after the run for `md5(ROW(`, a marker that appears only in the verify SQL built from the source column list.
  - Positive control: a normal dry run logged 34 such statements (17 tables × 2 servers), so the marker works.
  - **Attempt-2 bypass, column `"a|b<LF>c|d"` on the source:** exit 1, `unexpected source column list for table watchlist`, no `syntax error`, and **0** verify statements reached either server.
  - The same reproduction against the attempt-2 script (ba1f2b5): `ERROR: syntax error at or near "C"`, with verify SQL sent. So the reproduction tells the two versions apart.
  - Extra adversarial cases, all refused before any verify SQL (0 statements):
    - Column `"x<LF>foo|bar|baz<LF>y"`: the middle fragment looks valid, but the first fragment is refused first.
    - Column `"Note"`: quoted by `quote_ident`.
    - Table `"watchlist|id|id<LF>zzz"`: refused with `source table zzz is not a target data table`.
    - An extra source table `zzz`: refused with the same message.
- Mutation checks, run on the mirror copy and reverted afterwards (final diff to the committed script: only the version guard):
  - Removing the DB-name guard (:85) fails "source database name equal to the target (exit 2)" and "no docker call for any guard". Without the guard, the run gets as far as the dump step.
  - Removing the `$DATA_TABLES` membership check (:258-262) fails my two table-name cases. The committed harness does not catch it (Issue 1 below).
  - Removing the two `list_re` checks (:256-257) leaves **the whole committed harness green**, including `t_column_pipe_newline`. See Issue 1.
- **CI evidence** (GitHub REST API). The `ci` run on 60c1abd (job 134094116928) was `cancelled`, superseded by 396785f.
  - Job `ci` 134094735187 on PR #71 head 396785f concluded `success`. Every step was green: typecheck, lint, test, test:db (26 files), check:service-key (`OK: no secret or AI SDK material in client bundle`), check:deploy-env, db:check (`db:check OK`), and test:move (11 cases, 90 `ok`, 0 `FAIL:`, `test:move OK`).
  - `images (worker)` succeeded. `images (web)` was still in progress when I read it, and it is not part of this ticket's checks.
  - **The following rest on CI alone:** PG 17 server and client paths, real-docker `t_freeze`, bash 3.2 `-n` (`t_static`), and the dump mode 600 under a real container umask (`t_force` "the dump has mode 600").
  - The pre-created 0600 dump (Issue 2 of attempt 2) cannot be told apart from the `chmod` backstop locally, because `umask 077` already gives 600. It also cannot be told apart in CI, because the dump succeeds there and the `chmod` runs. It is verified by reading the code: `pg_dump -f` truncates an existing file and keeps its mode, and the container runs as the same uid (`--user $UIDGID`).

### Acceptance criteria (attempt-2 review items)
- [x] **F3: reject `|`/newline in source column lists; no SQL from a malformed list.**
  - Evidence: the reproduction above, with 0 verify statements on either server.
  - Code: `scripts/db-migrate-from-supabase.sh:256-257` checks `tcols`/`tpk` against `^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$`, and :258-262 checks `tname` against the target's `$DATA_TABLES`.
  - All of this happens inside the loop, before `vsql` is sent (:267-268). Every value put into SQL is now a validated bare identifier.
  - The target verify is still read-only (`dst_ro`, :268).
- [x] **F5: partial dump mode.** `: > "$WORK/$DUMP"` at :333 runs under umask 077 before `src_dump`, and `chmod 600` is kept at :335. `DUMP` is set before the pre-create, so a failed dry run still removes the file (:130). Evidence: code reading, plus CI `t_force` mode 600 and "a failed dry run leaves no dump" (local and CI).
- [x] **`$TMPDIR` docs.** `docs/deploy.md:112` now names macOS `/var/folders/.../T/` and `echo $TMPDIR`.
- [x] **F6: DB-name guard.** The guard is at :85 (exit 2, before any docker call). The harness assertion is at test :154 (local and CI, mutation-checked). `docs/deploy.md:118` states that both checks are string comparisons and do not detect aliases.
- [x] **No regression.** All 10 earlier cases are green locally (full run) and in CI. The happy-path dry run still verifies 17 tables, so no real stoktok column is refused by the stricter regex. `db/migrations` has no quoted identifiers.
- [x] **Nothing is applied to Supabase; no secret is committed.** The diff touches only the script, harness, docs and impl-log. `assert_no_leak` is green in both pipe cases.
- [x] **Repo checks green**: see above. test:move under PG 17 and real docker rests on CI.

### Issues
#### Issue 1 — 🟡 should-fix (does not block) — `t_column_pipe_newline` does not test the new F3 check
- **Where**: `scripts/test-db-migrate-from-supabase.sh:299-309`, with the column name `"n|o<LF>te"`.
- **Expected**: the new case fails when the attempt-3 F3 fix is removed. My attempt-2 instruction gave `"a|b"$'\n'"c|d"` for this reason.
- **Actual**: for `"n|o<LF>te"`, the second fragment `te"|…` already fails the attempt-2 `line_re` (:247). As a result:
  - the case passes against the attempt-2 script (ba1f2b5);
  - it also passes with :256-257 removed.
  - The committed harness therefore has no regression guard for the bypass. The fix itself is proven by the reviewer's reproduction above.
- **Fix instruction** (follow-up; a one-line change):
  - In `t_column_pipe_newline`, rename to `"a|b<LF>c|d"` instead of `"n|o<LF>te"`, so the second fragment `c|d",…|id` matches `line_re`.
  - Then add a case that creates a source table `zzz (id int primary key)` on the drift DB and asserts exit 1 and `out_has "not a target data table"`.
  - Both of the new cases fail on ba1f2b5. I checked this with my scratch copy.

### Rules R1–R10
No violations found.
- R3: no new secret exposure. The pgpass handling is unchanged.
- R7: 24a400e touches only the script, harness, docs and impl-log, all in the plan's list.
- R8: no `packages/core` change; the checks are green.
- R10: the source is still read only by `pg_dump` and by read-only, rolled-back SELECTs.
- R1, R2, R4, R5, R6 and R9 are not applicable.

### Nits (do not block)
- :247: the message `unexpected source column list (a name with | or a newline?)` and the :256 message `… for table <t>` can both appear for the same input, depending on where the fragment splits. Both contain the asserted substring.
- Still open from attempt 2: :278 uses `q_dst` (read-write session) for the `ai_keys` count. `$last` is not checked as numeric. There is no harness case for the HUP trap; I verified it by hand in attempt 2.

### Follow-ups (out of scope)
- Issue 1 above: strengthen `t_column_pipe_newline` and add the extra-table case. Suitable for `/solo` or STK-096.
- From earlier attempts: F4 (pin the client image by digest) and F7 (`verify-full`) are in STK-096. Run the real move inside `tmux`/`screen`. Rotate the Supabase DB password after the cutover.
