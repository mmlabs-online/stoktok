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
