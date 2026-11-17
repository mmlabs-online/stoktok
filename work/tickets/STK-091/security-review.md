# STK-091 security review

## Attempt 1

Security review of STK-091 (`scripts/db-migrate-from-supabase.sh`, test harness, fixture, `package.json`, `ci.yml`, `docs/deploy.md`). I only read files and changed nothing. I did not run the script.

**Verdict: no 🔴 blockers.** The core promises hold: the Supabase source is only read, no password goes on argv, the truncate target is allow-listed, and the CI step has no secrets. There are 7 🟡 items. Two of them should be fixed in this ticket because they make a plan/doc claim false or leave the source password on disk (F1, F2). F3 is a one-line hardening worth taking now.

### Findings

**F1 🟡 (medium): the target DB password ends up in the container's env, contrary to plan.md:136.** `scripts/db-migrate-from-supabase.sh:209-210`
- `STOKTOK_DATABASE_URL="postgres://$DST_USER:$DST_PW@…" docker run -e STOKTOK_DATABASE_URL "$IMAGE" migrate` keeps the password off argv. But the full URL is copied into the container's `Config.Env`, so `docker inspect` shows it while the migrate container runs, and so does `/proc/1/environ` inside it.
- plan.md:136 says "Passwords are never … in container env (pgpass)". docs/deploy.md:112 says the URL is "only an inherited environment variable", which is true but understates this.
- Real exposure is small. Anyone who can run `docker inspect` is already root-equivalent, and the long-running worker container holds the same URL in its env. `apps/worker/src/migrate.ts:30` prints only `err.message`/`code`, not the URL.
- The harness never tests this path. Every test uses `--skip-migrate`, so `assert_no_leak` doesn't cover it.
- Fix (one of):
  - (a) Correct plan.md:136 and deploy.md:112: "the migrate container gets the URL in its env (visible to `docker inspect` for its lifetime, like the worker's)".
  - (b) Run migrate with the URL read inside the container from the mounted secrets dir, e.g. `-v "$SECRETS:/secrets:ro" --entrypoint sh "$IMAGE" -c 'STOKTOK_DATABASE_URL="$(cat /secrets/dburl)" exec <migrate cmd>'`.
  - (a) is enough given R3's existing deploy model.

**F2 🟡 (medium): the pgpass file, holding both passwords, can outlive the run.** `:131-132`, `:148-154`
- `trap cleanup EXIT` plus `trap 'exit 130' INT TERM` does not cover **HUP**. The realistic failure is an SSH session to the Mac dropping during a long dump. Whether bash runs the EXIT trap on an untrapped fatal signal is not something I'd rely on.
- On SIGKILL or power loss, `$TMPDIR/tmp.XXXX/pgpass` stays behind with the Supabase password and the stoktok password in clear text. That directory is mode 700 per user, so it's mitigated but not gone.
- Fix: `trap 'exit 129' HUP` next to INT/TERM. Also delete `$SECRETS/pgpass`'s source line, or the whole file and re-create a target-only one, right after the last source call (`SRC_SEQ` at :327; the source is needed again in `verify_phase`, so restructure or accept). At minimum, add a line in docs/deploy.md saying that after a killed run you check `$TMPDIR` for `tmp.*/pgpass` and then rotate the Supabase DB password after the cutover anyway.
- Test gap: no harness test sends INT/TERM/HUP and checks that `$TMP/sd` is empty afterwards.

**F3 🟡 (low-medium): SQL built from the source catalog is run on the target in a read-write session.** `:230-244`
- `tcols`/`tpk` come from the **source's** `quote_ident(attname)`, and only `tname` is regex-checked (:236). The same `vsql` is piped to `dst_psql` (:244), which is a writable session on the target.
- A column name containing `|` or a newline breaks the `IFS='|' read` split (:234). The result can be an unbalanced quoted identifier in `ROW($tcols)`, which then runs on the target. That needs someone with DDL rights on Supabase, so the threat is low, but the defence is one line.
- Fix: run the target side read-only too: `printf … | { printf 'begin transaction read only;\n'; cat; printf ';\nrollback;\n'; } | dst_psql`, or add a `dst_ro` sibling of `src_ro`. Optionally regex-check `tcols`/`tpk` against `^("[^"]*"|[a-z_][a-z0-9_]*)(,…)*$` or reject `|`/newline.

**F4 🟡 (low): the default pg client image is unpinned and gets both passwords.** `:69`
- `PG_CLIENT_IMAGE=pgvector/pgvector:pg17-trixie` is a mutable tag. Every `pg_run` mounts `$SECRETS` (both passwords) and has network access, on bridge to the internet for the source leg.
- If that tag is ever replaced with a malicious image, both credentials leak.
- Fix: pin by digest (`…@sha256:<digest>`), ideally the digest the shared Postgres already runs. The regex at :84 already allows `@`. CI's `postgres:17` and `bash:3.2` are unpinned too, but CI holds no secrets, so that's informational.

**F5 🟡 (low): the dump and schema files are created mode 0644.** `:290-292`, `:308`
- `pg_dump -f /work/…` runs in a container with Docker's default umask 022, so `stoktok-supabase-*.dump` is 0644. The script's `umask 077` doesn't reach the container.
- The work dir is 700 and that's checked (:156), so nobody else can read it today. But a later `cp`/`rsync -a` to another location keeps the world-readable mode on unencrypted financial data.
- Fix: `chmod 600 "$WORK/$DUMP"` right after :308. Or pass `--entrypoint sh … -c 'umask 077; exec pg_dump "$@"'` in `pg_run`.
- Related: a **failed dry run** (for example restore fails at :318, or the exit at :358 path before the delete at :356) leaves the dump even without `--keep-dump`, because `cleanup` only removes `$SECRETS`. Either remove `$WORK/$DUMP` in `cleanup` when `DRY=1 && KEEP_DUMP=0`, or document it.

**F6 🟡 (low, defence in depth): nothing explicitly stops the target leg from pointing at the source.** `:63-83`, `:184-190`
- The truncate (:272) and restore (:318) go to `DST_HOST/DST_PORT`. Today the source is protected indirectly:
  - `DST_USER` must match `^stoktok…`
  - `current_database()` must equal `stoktok`/`stoktok_scratch*`, and Supabase's is `postgres`
  - the login must not be a superuser
- That is sufficient in practice. But no explicit `"$DST_HOST:$DST_PORT" != "$SRC_HOST:$SRC_PORT"` check exists, and no server-identity comparison.
- Fix: add the host:port inequality guard in section 1. That one line makes AC2 hold by construction rather than by naming convention.

**F7 🟡 (info): source TLS is `require`, which does not verify the server certificate.** `:62`
- SCRAM limits what a man-in-the-middle can learn, but with `require` a MITM can still read the dumped data.
- Fix: optional support for `verify-full` with a mounted `sslrootcert` (the Supabase CA). The script already accepts the mode (:87), but there's no way to mount a root cert. Follow-up, not this ticket.

**Nit:** `:336-340`: `$mx` is put into `setval(…)` unchecked when `$last` is empty. It comes from `max(<identity int col>)`, so it is numeric in practice. A `[[ "$mx" =~ ^-?[0-9]+$ ]] || fail` check would be cheap.

### Checked and clean
- **Source writes:** only `src_dump` (pg_dump) and `src_ro` (:168-173) name `SRC_HOST`. `src_ro` wraps every statement in `set default_transaction_read_only = on; begin … read only; … rollback`. All SQL piped to `src_ro` is script constants, and `vsql` is built from validated or quoted pieces (see F3). No migration runs on the source, because `migrate` targets `DST_HOST`/`TARGET` only. pg_dump with `--data-only` on RLS tables fails closed rather than producing a partial dump.
- **argv:** no password on any docker or psql argv. pgpass escaping of `\` and `:` is correct (:149), and newlines are rejected (:114). `MOVE_SRC_PGPASSWORD` is unset before any docker call (:105), so children don't inherit it. The target password file is validated without printing its content (:97-101).
- **Injection:** target table names are checked with a regex (:224). Identity rel/col/seq are regex-checked (:334). Host, user, DB, port, network, image and project variables are all checked against regexes (:56, :74-85). Docker args are quoted.
- **Target allow-list and truncate:** targets are limited to `^stoktok(_scratch…)?$`, and a dry run must use a scratch target. `--force` requires `--confirm <same name>` and is refused with `--verify-only`. A real run fails on freeze (lock dir or running compose containers) before any write, so a truncate of production cannot happen while the app is live. The truncate is in one transaction. `ai_keys` is excluded from the dump, and the TOC diff enforces the exact table set.
- **Work dir:** created under umask 077 and must be exactly mode 700. A symlinked `--work-dir` is rejected, because `find -P` reports 777.
- **CI (`ci.yml:54-56`):** the workflow has `permissions: contents: read`, and the `ci` job references no secrets. `MOVE_TEST_URL` points at the throwaway service container, and the harness refuses any host other than localhost (harness :17-18). Fork PRs get no secrets. The fixture is synthetic, and its `ai_keys` ciphertext is filler bytes.
- **Harness:** role passwords are random `SENTINEL…` values passed on psql `-c` argv (:70). That's acceptable for a throwaway CI database. The docker shim logs argv to prove no sentinel appears there.

### Recommendations
- **R3/AC3:** fix F1 (doc/plan wording, or the URL-from-file approach) and F2 (HUP trap plus a doc note).
- **AC2:** F3 (read-only target verify) and F6 (host inequality guard) are one line each.
- F4 (pin by digest) and F5 (chmod 600 on the dump, clean up after a failed dry run) can go in this diff or as follow-ups. F7 goes to follow-ups.

### Risks
- After the move, an unencrypted dump of the whole portfolio stays in `~/srv/backups/stoktok-cutover` for 14 days, and its deletion depends on STK-095.
- If `~/srv/backups` is ever added to an offsite or Time Machine sync, the "not offsite-synced" claim in docs/deploy.md:116 becomes false without anyone noticing. That's worth a path outside `backups/` or an explicit exclusion.

### Open questions
- Should the Supabase DB password be rotated after the cutover anyway, given it goes into a pgpass file on disk and possibly into shell history if `MOVE_SRC_PGPASSWORD` is exported? Does docs/deploy.md:109 prefer the prompt?
- plan.md:162 reads Ming's "only read-only pg_dump" as allowing read-only SELECTs as well. Has Ming confirmed that reading?

Files: /home/user/stoktok/scripts/db-migrate-from-supabase.sh, /home/user/stoktok/scripts/test-db-migrate-from-supabase.sh, /home/user/stoktok/.github/workflows/ci.yml, /home/user/stoktok/docs/deploy.md, /home/user/stoktok/work/tickets/STK-091/plan.md

## Attempt 2

Security re-review of STK-091 attempt 2. I read `scripts/db-migrate-from-supabase.sh`, `scripts/test-db-migrate-from-supabase.sh`, `docs/deploy.md` (lines 101-120) and the impl-log "Attempt 2". I changed nothing and ran nothing.

**Verdict: no 🔴.** F1, F2 and F5 are closed. F6 is closed only as a hostname check: an alias or IP gets past it, and the test harness itself relies on that. F3 is only partly closed: the new line check can be passed with a crafted column name. Each gap has a one-line fix, listed below. Cleanup can never delete the dump on a real run.

### Status of each attempt-1 finding

**F1: closed (docs).** `docs/deploy.md:112` now says the migrate container has the URL, password included, in its env, visible to `docker inspect` for its lifetime, like the worker. That matches the code at `scripts/db-migrate-from-supabase.sh:220-221`. One loose end: `plan.md:136` still says passwords are never in container env. impl-log:48-49 records the mismatch; leave it to the planner or a follow-up.

**F2: closed, with one docs nit.**
- `:138` `trap 'exit 129' HUP` is in place. `cleanup` (`:125-135`) runs `rm -rf "$SECRETS"` first, before any write to stderr. So even if the SSH tty is gone and the `echo` fails, the pgpass file has already been deleted. Bash runs the trap once the foreground `docker run` exits, and the docker CLI gets the same HUP, so the delay is short.
- 🟡 `docs/deploy.md:112` says to check "`$TMPDIR` (default `/tmp`)". On the Mac where this runs, `$TMPDIR` is normally `/var/folders/<..>/T/`, not `/tmp`. A runbook reader who looks in `/tmp` will miss the leftover `tmp.*/pgpass`. Fix: "check `$TMPDIR` (on macOS usually `/var/folders/.../T/`; `/tmp` only if unset)". Also run `echo $TMPDIR` in the session that ran the script.
- Still untested, as impl-log:56 says: no harness case sends HUP. That's acceptable.

**F3: partly closed. 🟡 The column-list check is too loose.** `:245` `line_re='^[a-z_][a-z0-9_]*[|][^|]+[|][^|]*$'` and `:248`.
- The check runs on each line, but the source output is split on newlines (`:246`). A column name containing both `|` and a newline can produce two lines that each match.
  - Example: a column named `a|b<LF>c|d` on `watchlist`. `quote_ident` gives `"a|b<LF>c|d"`.
  - Line 1 is `watchlist|symbol,…,"a|b`. It matches, with `tcols` = `symbol,…,"a` (an unbalanced quote) and `tpk` = `b`.
  - Line 2 is `c|d"|symbol`. It also matches, with `tname=c` (passes `:252`) and `tcols` = `d"`.
- So `vsql` gets built with unbalanced quoted identifiers, which is exactly what F3 was about. `t_column_pipe` (harness `:287-295`) only tests `n|ote`. That has 3 pipes on one line, so it is caught, and the case above is not tested.
- I could not build a payload that puts attacker-chosen SQL outside the quotes: `quote_ident` doubles inner `"`, and the template's `collate "C"` changes the quote parity. So actual injection is unproven (medium confidence).
- The new `dst_ro` (`:181-185`) is the right fix for accidents, but it does not stop deliberate injection. Injected SQL can run `commit; set default_transaction_read_only = off; …`, so the input validation is the real defence.
- The threat still needs DDL rights on Supabase, so it stays low.
- Fix (one line each, after `:252`):
  - `[[ "$tcols" =~ ^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$ && "$tpk" =~ ^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$ ]] || fail "unexpected source column list"`. stoktok's columns are all lowercase snake case, so `quote_ident` returns them unquoted. Any name that needs quoting is therefore refused, and a split line always fails.
  - Also require `tname` to be in `$DATA_TABLES`: `printf '%s\n' "$DATA_TABLES" | grep -qx "$tname" || fail …`. A fake `c` table from a split line can then never reach `vsql`.
  - Add a harness case with a column name containing `|` and a newline.

**F5: closed. 🟡 One small gap.**
- `:325` `chmod 600` runs after a successful dump, and `t_force` asserts mode 600 (`:251`).
- Cleanup deletion (`:129`) only happens when `rc≠0 && DRY=1 && KEEP_DUMP=0 && DUMP` is set. **A real run (`DRY=0`) can never delete the dump.** `DUMP` is set at `:323` before `src_dump`, so a partial dump from a failed dry run is deleted too. An exit with status 2 happens before `DUMP` is set. `t_schema_drift` (`:276`) covers the failed-dry-run path.
- Gap: if `src_dump` fails partway through a **real** run (or a `--keep-dump` dry run), `:325` is never reached. The partial dump then stays at the container's 0644 mode. It sits inside the 700 work dir, so the risk is low.
- Fix: before `:324`, run `: > "$WORK/$DUMP"`, which creates the file as 0600 under the script's `umask 077`. `pg_dump` runs as the same UID (`--user "$UIDGID"`), opens the existing file and keeps its mode. `:325` then stays only as a backstop.

**F6: string guard only. 🟡 An alias gets past it.** `:82-84`
- The check compares the host:port strings in lowercase. `localhost` vs `127.0.0.1`, a hostname vs its IP, a trailing dot (`host.`, allowed by the `:81` regex), a pooler vs direct hostname, and `05432` vs `5432` all get past it.
- The harness does exactly this on purpose (`:97-98`, `ALT_HOST`). So the check prevents a copy-paste mistake, but AC2 still depends on the naming-convention guards (`DST_USER` regex, `current_database()`=TARGET, non-superuser). The "by construction" outcome F6 asked for is still not there.
- Fix: in section 1, add `[ "$SRC_DB" != "$TARGET" ] || usage_err "source database equals the target database"`. Every write goes to database `$TARGET` (`:288`, `:335`, `:339`, `:358`), and the preflight already confirms `current_database()` equals `$TARGET` (`:200`). So if `SRC_DB ≠ TARGET`, no write can touch the source database, even when both legs reach the same server under different names. The harness still passes, because `stoktok_mvsrc_*` ≠ `stoktok_scratch_mv*`.
- Also adjust `docs/deploy.md:118` so it doesn't promise more than a hostname comparison.

**Nits: closed.** `:355` checks `$mx` is numeric before `setval`. `:365` asserts exactly 6 identity sequences. `:233`/`:327` use C collation and C sort.

### New issues introduced by attempt 2
- None 🔴.
- Harness `:97-98`: the alias workaround is fine for tests, but it shows the F6 limit above. Once the `SRC_DB ≠ TARGET` check is added, the harness no longer depends on F6 being bypassable in a way that matters.
- `dst_ro` (`:181-185`) sends `$pre` and then the statements inside one rolled-back read-only transaction, so `set TimeZone` etc. are scoped correctly. No issue.

### Recommendations
- **AC2:** add the `SRC_DB ≠ TARGET` guard (F6) and the strict `tcols`/`tpk` regex plus the `tname ∈ DATA_TABLES` check (F3), with a harness case for a column name containing `|` and a newline.
- **R3/AC3 (docs):** correct the `$TMPDIR` default for macOS at `docs/deploy.md:112`.
- Optional: pre-create the dump file as 0600 (F5 gap).

### Risks
- Unchanged from attempt 1: an unencrypted dump of the whole portfolio stays in `~/srv/backups/stoktok-cutover` for 14 days (STK-095). Also, the "not offsite-synced" claim at `docs/deploy.md:116` becomes false without anyone noticing if `~/srv/backups` is ever added to a sync or Time Machine.
- F4 (client image not pinned by digest) and F7 (TLS `require` doesn't verify the server certificate) remain open in STK-096, as Ming decided.

### Open questions
- Should the STK-096 runbook require running the script inside `tmux`/`screen`, so an SSH drop doesn't kill a real run partway through and leave a partial dump?
- Rotating the Supabase DB password after the cutover is still undecided (attempt-1 question).

Files: /home/user/stoktok/scripts/db-migrate-from-supabase.sh, /home/user/stoktok/scripts/test-db-migrate-from-supabase.sh, /home/user/stoktok/docs/deploy.md, /home/user/stoktok/work/tickets/STK-091/impl-log.md, /home/user/stoktok/work/tickets/STK-091/security-review.md

## Attempt 3

Security re-review of STK-091 attempt 3. I read `scripts/db-migrate-from-supabase.sh`, `scripts/test-db-migrate-from-supabase.sh` and `docs/deploy.md:101-119`, plus impl-log "Attempt 3" and a column-name scan of `db/migrations/`. I changed nothing and ran nothing.

**Verdict: no 🔴. F3, F5 and F6 are closed, and so is the `$TMPDIR` docs item. Nothing new at security level.** There are two 🟡 info nits, neither blocking.

### Status of each attempt-2 item

**F3: closed.** `scripts/db-migrate-from-supabase.sh:246-262`
- After the split, `tcols` and `tpk` must match `^[a-z_][a-z0-9_]*(,[a-z_][a-z0-9_]*)*$` (`:256-257`).
- `quote_ident` only leaves a name unquoted when it is already lowercase snake case. So any name with `|`, a newline, uppercase or a reserved word comes back with a `"`, and the check refuses it.
- My attempt-2 example (`a|b<LF>c|d`) now fails on line 1: `tcols` ends in `"a` and fails at `:256`. Any split piece has the same problem, because it always carries an unbalanced `"`. Nothing reaches `vsql` (`:263`) unless every part is a plain identifier, so injection through the column list is closed by construction.
- `tname` is regex-checked (`:254`) and must be a member of `$DATA_TABLES` (`:258-262`). The membership test uses a newline-delimited `case` glob, which is safe because `tname` is already restricted to `[a-z0-9_]` and has no glob characters.
- Functional check: the real schema only uses names `quote_ident` leaves unquoted (`symbol` and `value` are unreserved keywords), so the stricter regex does not break the real move.
- Test: `t_column_pipe_newline` (harness `:299-309`) renames the column to `"n|o<LF>te"` and asserts exit 1 with "unexpected source column list". That exercises the new `:256` path, not only `line_re`. Both messages share that substring, so the assertion passes either way.

**F5: closed.** `:332-335`
- `DUMP` is set, then `: > "$WORK/$DUMP"` runs under `umask 077`, so the file starts at 0600 before `pg_dump`.
- `pg_dump` runs as the same UID (`--user "$UIDGID"`, `:168`) and truncates the existing file, which keeps its mode. A partial dump from a failed real run is now 0600 too. `chmod 600` stays as a backstop.
- `t_force` still asserts mode 600 (harness `:253`).
- Cleanup (`:130`) is unchanged and still can never delete the dump on a real run.

**F6: closed.** `:85` refuses `SRC_DB == TARGET` with exit 2, before any connection.
- Every write goes to database `$TARGET`: the truncate (`:297`), restore (`:345`), `analyze`/`setval` (`:349`, `:368`) and the migrate URL (`:221`). Preflight confirms `current_database() = $TARGET` (`:201`).
- So even if both legs reach the same server through an alias, the writes land in a different database from the source.
- Test: harness `:154-155`.
- `docs/deploy.md:118` now promises only two string comparisons and says outright that aliases are not detected. That is accurate.

**`$TMPDIR` docs: closed.** `docs/deploy.md:112` now names macOS `/var/folders/.../T/`, says `/tmp` only applies when `$TMPDIR` is unset, and says to run `echo $TMPDIR` in the same session.

### New issues
- 🟡 (info, docs) `docs/deploy.md:118`: the last sentence, "The target-side comparison also runs in a read-only transaction", sits right after the host and DB-name guards, so it reads as if it describes them. It actually means the verify md5 query (`dst_ro`, `:269`). Suggested wording: "The verify step reads the target in a read-only transaction too." Not a security gap.
- 🟡 (info, test) `t_column_pipe_newline` only works if `t_column_pipe` ran first, because it renames `"n|ote"` (harness `:301`). impl-log:80 already notes this. Running it on its own (`test:move t_column_pipe_newline`) fails on setup, which is a false failure, not a false pass. It could be made self-contained later.
- Test caveat, not a finding: locally the move cases ran with a stand-in `docker` and the `-ge 170000` guard temporarily relaxed, then restored (impl-log:80). `t_static` and `t_freeze` run only in CI, so a green CI run is the real evidence.

### Recommendations
- No changes needed for AC2 or R3. The `deploy.md:118` wording fix is optional and can go in this diff or the STK-096 runbook.

### Risks (unchanged)
- An unencrypted dump of the portfolio stays in `~/srv/backups/stoktok-cutover` for 14 days (STK-095). The "not offsite-synced" claim (`docs/deploy.md:116`) silently becomes false if `~/srv/backups` is ever added to a sync.
- F4 (client image not pinned by digest) and F7 (TLS `require` doesn't verify the server certificate) are still deferred to STK-096.

### Open questions (carried over)
- Should the Supabase DB password be rotated after the cutover?
- Should the STK-096 runbook require running the script inside `tmux` or `screen`?

Files: /home/user/stoktok/scripts/db-migrate-from-supabase.sh, /home/user/stoktok/scripts/test-db-migrate-from-supabase.sh, /home/user/stoktok/docs/deploy.md, /home/user/stoktok/work/tickets/STK-091/impl-log.md, /home/user/stoktok/work/tickets/STK-091/security-review.md
