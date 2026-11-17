STK-084 database consult (read-only; nothing edited). Delta over the STK-080 consult (`work/tickets/STK-080/consult-database-optimizer.md` §7, lines 119-133) and the STK-083 consult. Not repeated: COPY into GENERATED ALWAYS identity is allowed, no `--inserts`, `--no-owner --no-privileges`, `ai_usage` kept, one FK ordering, 17 tables. `scripts/db-migrate-from-supabase.sh` does not exist yet (`scripts/` holds only db-check, schema-diff, check-* and probe scripts).

## Findings

### 1. The network shape drives the script design
- The `db` network is created `--internal` (`/home/user/deployment/postgres/compose.yml:17`, `:113-118`). A container on `db` can reach `postgres:5432` but has no egress, so it cannot reach Supabase. One container cannot do dump and restore.
- The script therefore has two legs:
  - Dump and the source-side checksums run in `docker run --rm` on the default bridge network (internet, no `db`).
  - Restore, migrate and target-side checksums run in `docker run --rm --network db`.
  - The dump file passes between them by bind mount.
- Use the same PG17 image the server runs, `pgvector/pgvector:pg17-trixie` (`compose.yml:31`). `ops/backup/restore-test.sh:15` already does this through `PG_RESTORE_IMAGE`, so reuse that variable name.
  - It is already on the box, so no pull is needed.
  - A host `libpq` from brew may be 18. A `pg_dump` 18 archive is unreadable by `pg_restore` 17, so never mix versions.
- Container invocation details:
  - Use `--entrypoint pg_restore`, `--entrypoint psql` and `--entrypoint pg_dump` explicitly.
  - Pass credentials as `-e PGPASSWORD` with no value, so docker inherits it from the script's environment and it never appears on argv or in `docker inspect`.
  - Use discrete `PGHOST/PGPORT/PGUSER/PGDATABASE` variables, not a URL. This avoids URL-encoding of Supabase passwords and argv exposure.
  - Read the target password from `~/srv/postgres/secrets/apps/stoktok.password` (`add-app-db.sh:37` generates it as URL-safe hex).
  - Mount the dump `:ro`.
- Supabase source:
  - Use the session pooler on port 5432 (user `postgres.<ref>`, host `aws-0-<region>.pooler.supabase.com`). The direct host `db.<ref>.supabase.co` is IPv6-only on Free, and Docker VMs on a Mac often have no IPv6.
  - Set `PGSSLMODE=require`. The transaction pooler on 6543 is not usable.
- Run restore as the `stoktok` login on `db`, not as superuser.
  - It proves the exact credential, pg_hba and scram path the app will use (`compose.yml:40`, `--auth-host=scram-sha-256`).
  - A data-only restore into tables the role owns needs no extra privilege.
  - The fallback is `docker exec -i postgres pg_restore -U postgres --no-owner --role=stoktok < dump`, as in `ops/backup/RESTORE.md:143`.
- macOS bash 3.2 and BSD tools: no `mapfile`, no associative arrays, no GNU `sed -i`. Use `shasum -a 256`, `umask 077`, `mktemp -d`. This is the standard of `add-app-db.sh:2`.

### 2. Schema before data: the chicken-and-egg with the migrate runner
- The runbook order in the ticket (`ticket.md:15`) is "dump, restore, verify, cut the first release, start". The schema, however, comes from the runner, which ships only in the worker image (`db/migrations/README.md:6`: `docker run <worker image> migrate`).
- The script must therefore take the candidate worker image (`STOKTOK_WORKER_IMAGE`, a tag built by CI) and run it.
  - Use `docker run --rm --network db -e STOKTOK_DATABASE_URL ... <image> migrate`.
  - Build the URL in memory from the password file. Never `echo` it or put it on argv.
  - Alternatively use `docker compose --profile migrate run --rm migrate` from `apps/stoktok/compose.yml` once that file exists.
- Cutting the image without deploying must be possible, or the runbook must say "build, then script, then deploy".
- The later deploy workflow's migrate then reports "up to date" (`migrate.ts:177-179`), so it is idempotent.
- After migrate, assert that `schema_migrations` holds exactly the expected versions (`20261111000200`, the file's checksum).
  - The runner treats an "ahead" DB as exit 0 with a warning (`migrate.ts:173-176`), so exit 0 alone proves nothing.
  - Do not restore into a schema that is not exactly the image's.

### 3. Column order and COPY safety
- `pg_dump` (`-Fc` or plain) always writes `COPY public.t (col, col, ...) FROM stdin`, with an explicit column list. Positional attnum drift therefore cannot corrupt a restore.
  - The STK-083 warning about positional COPY (`consult-database-optimizer.md:158`) applies only to hand-rolled `\copy` without a column list. Do not hand-roll.
  - A column missing in the target gives a loud `column does not exist` error, and `--single-transaction` rolls the data back.
- The baseline keeps `data_gaps.resolved_reason` and `symbols.sector*` as added columns (`20261111000200_baseline.sql:149-156` and `:200-203`), so `t::text` row layout also matches Supabase's.
  - That is not safe once a post-baseline migration lands before cutover. Section 6 handles it.
- `ai_keys` exclusion is mandatory, not just tidy.
  - The live Supabase `public.ai_keys` has the Vault shape (`secret_id`...). The STK-083 "A" chain includes `20261110000200_ai_keys.sql` and excludes only `20261111000100` (`scripts/schema-diff.sh:56-58`).
  - The baseline `ai_keys` has different columns (`baseline.sql:482-490`).
  - Without `--exclude-table=public.ai_keys` the COPY fails (loud, fine), but with a fixed list it could also silently skip.
  - Defensive additions:
    - `--exclude-table=public.schema_migrations`. Supabase has none in `public` (its own is in `supabase_migrations`, which `--schema=public` excludes). If one ever existed, it would collide with the runner's row.
    - After the dump, run `pg_restore -l dump | grep -E 'TABLE DATA'` and diff it against the target's table list minus `schema_migrations` and `ai_keys`. This gives a fast named failure before touching the target.
    - Post-restore assertion: target `ai_keys` has 0 rows.
- Vault rows in `vault.secrets` (`stoktok_ai_key_%`) live in another schema, so they are never dumped. AC3's "delete after the window" is unaffected.

### 4. Identity sequences: do not lower them
- `pg_dump --data-only` includes `SELECT pg_catalog.setval('public.<seq>', last_value, is_called)` for the 6 identity sequences (`transactions_seq_seq`, `data_gaps_id_seq`, `signals_id_seq`, `news_id_seq`, `ai_usage_id_seq`, `ai_summaries_id_seq`). They preserve the source `last_value`.
- Ticket text says "`setval` for the 6 identity sequences". Do not blindly `setval(..., max(col))`.
  - If rows were deleted at the tail (resolved `data_gaps`, pruned news), `max` is lower than the source `last_value`. Resetting to `max` re-issues ids that may still be referenced externally. `baseline.sql:344` notes news ids are referenced by future `suggestions.news_ids`.
- Do this instead:
  - Rely on the dump's `SEQUENCE SET`.
  - Then, per sequence, `setval(seq, greatest(max(col), last_value), true)` only if `last_value < max(col)` or the sequence is uncalled while rows exist.
  - Resolve the sequence name with `pg_get_serial_sequence(...)`; it handles identity.
- Add the six `(last_value, is_called)` pairs to the source-vs-target comparison. Read them from `pg_sequences` on both sides.
- `setval` is non-transactional, so a failed `--single-transaction` restore rolls the rows back but leaves sequences advanced.
  - The "target is empty" refusal must therefore test table rows, never sequence state.
  - Force mode's `TRUNCATE ... RESTART IDENTITY` resets them.

### 5. Refusing a non-empty target
- Do not test only `transactions` (the STK-080 suggestion). The failure that actually matters is the app having started on the new DB before the restore.
  - `settings` is a single-row id=1 table that the web app may upsert on first visit, so the restore would hit a duplicate-key error.
  - The test should be "sum of `count(*)` over every public table except `schema_migrations`". Enumerate the tables from the catalog (`pg_tables`), not a hand-kept list, so a future table is covered.
- Do not implement force as "restore on top". `pg_restore --clean` cannot combine with `--data-only`.
  - Force should mean: a separate explicit `TRUNCATE <all those tables> RESTART IDENTITY` in one transaction, executed only after typing or passing the database name.
  - It must never truncate `schema_migrations`.
- Allow-list the target database name: `stoktok` or `stoktok_scratch*`. Print `current_database()`, `current_user` and `server_version_num` (require ≥170000) before any write.
- Dry run on a scratch database:
  - `docker exec postgres psql -U postgres -c "create database stoktok_scratch owner stoktok"`.
  - `stoktok_scratch` is not in `config/databases` (`add-app-db.sh:39-44`), so the sidecar never dumps it. Drop it with `WITH (FORCE)` afterwards.
  - Real financial data sits in it, so also delete the dump file.

### 6. Verification: counts plus ordered md5
- Pin the formatting on both sides, with `SET` statements in the same psql session (not PGOPTIONS, which the Supavisor pooler rejects; same reasoning as ADR 0010:11): `TimeZone='UTC'`, `DateStyle='ISO, YMD'`, `IntervalStyle='postgres'`, `extra_float_digits=1`.
- Generate the per-table SQL from the catalog with `format()` and `\gexec`. Compare `table|count|md5` lines between the two sides with `diff`.
- Per row, then aggregate, rather than one giant `string_agg`:
  `md5(coalesce(string_agg(md5(ROW(<cols>)::text), '' order by ROW(<pk cols>)::text COLLATE "C"), ''))`
  - Per-row md5 avoids the 1 GB text limit on `prices_intraday`.
  - `COLLATE "C"` matters because Supabase's database collation and the container's can differ, and `symbol` pks are text. Ordering by `ROW(pk)::text COLLATE "C"` is deterministic and equal on both sides.
  - Fail if a table has no primary key. All 17 have one.
- Take `<cols>` from the source's `information_schema.columns` in `ordinal_position` and use that same list on the target. Plain `t::text` would break if a post-baseline migration adds a column before cutover. With an explicit list, extra target columns are ignored and a missing one is a loud error.
- Quiesce writers. The ticket says to stop the worker. The web app's server actions also write (transactions, settings, lottery tickets, AI keys), so stop `stoktok-web` too, or accept that a mismatch will flag it. Run the source checksums after the dump, with writers stopped. Re-run if there is a mismatch.
- Output contains no row data (names, counts, hashes), so it is safe to keep in `work/tickets/STK-084/`.
- Run `ANALYZE` once after restore. COPY leaves no planner statistics. `VACUUM` is not needed.

### 7. PG version differences (Supabase 15/17 to 17)
- `pg_dump` 17 can dump a 15 or 17 server. The `pg_restore` 17 target is never older than the archive, so the pairing is safe. Print `show server_version_num` on the source and require `pg_dump --version` major ≥ source major.
- `-Fc` archives contain no `\restrict` lines (those appear only in plain-text output), so no normalisation is needed for the restore. They matter only for the schema diff in section 11.
- Indexes and unique constraints are rebuilt by the load, so a glibc or collation difference between Supabase and the Debian trixie container cannot leave a corrupt text index. The one place it bites is the md5 `ORDER BY` (handled above).
- Data types are all core types (no `numeric`, ADR 0010:12), so there is no format drift between 15 and 17 beyond the pinned settings.
- `gen_random_uuid` needs no extension on either side (`baseline.sql:12`).

### 8. `schema_migrations`
- The runner creates `public.schema_migrations` itself (`migrate.ts:162-169`), outside the baseline file, so it is not in the schema diff and not in the data dump (excluded, see section 3).
- It must exist with exactly one row (the baseline) before restore, and the restore must not touch it. Keep it out of the verification table list and out of force's `TRUNCATE`.
- The runner's advisory lock key `7865372087` (`migrate.ts:13`) is session-level and held only while migrate runs, so it does not interfere with the restore. Do not run restore concurrently with a deploy's migrate; the runbook's stopped worker covers it.

### 9. Backup sidecar picks up `stoktok` automatically
- `add-app-db.sh stoktok` appends the name to `postgres/config/databases` (`add-app-db.sh:39-44`; currently `calechip`, `ricotdin`, `org_admin`, `tudocuatui`).
- The sidecar reads `POSTGRES_DB_FILE=/run/pg-config/databases` on every run as the `postgres` superuser (`compose.yml:74-77`, directory mount `:90`). `stoktok` is dumped at the next 02:00 with no restart and no extra grant.
- The dump is custom format, so `ops/backup/restore-test.sh stoktok` works unchanged.
  - Its role-placeholder grep (`restore-test.sh:73-77`, `\bstoktok_[a-z0-9_]+\b`) matches nothing in the stoktok schema. The `stoktok.ai_budget` lock key at `baseline.sql:405` has a dot, not an underscore.
- Two operational notes:
  - The offsite sync refuses to run (and pings `/fail`) unless every listed database has a dump under 26 h old (`RESTORE.md:21-23`). If `stoktok` is added to the list between 02:00 and 03:30 there is one false failure. After deploy-postgres creates it, run `docker compose -p postgres -f ~/srv/postgres/compose.yml exec pg-backup /backup.sh` (the same command `RESTORE.md:191` uses).
  - The pre-migration dump is `/backup.sh`, which dumps every database. A same-day run overwrites `daily/<app>-YYYYMMDD.dump` (`RESTORE.md:18`); the timestamped copy in `last/` is kept for only 24 h (`:14`). For the cutover, also copy the pre-cutover `last/stoktok-*.dump` somewhere outside the retention folders.
- The Supabase data dump sits outside the backup tree. Put it in something like `~/srv/backups/stoktok-cutover/` (mode 700, `umask 077`) and delete it when the rollback window closes. The ticket's rollback window is proposed at 14 days. The offsite sync mirrors only `daily/`, `weekly/` and `monthly/` (`RESTORE.md:15`), so this dump is not uploaded. It is unencrypted financial data on local disk.
- Master key separation (ADR 0011): `ai_keys` ciphertext is in nightly dumps but the key is not. This is the intended split; no change.

### 10. `idle_in_transaction_session_timeout`: where to set it
- Recommended: in `packages/db/src/pg/client.ts` session init, as a third `set_config('idle_in_transaction_session_timeout', $n, false)` next to the existing ones at `client.ts:78`.
  - Make it a profile field in `config.ts:14` and `:16`, for example 30 s for web and 60 s for worker.
  - This is consistent with ADR 0010 §3 (`:11`: `set_config` in session init, not startup `options`, so it also works through a session pooler).
  - It is unit- and `test:db`-testable in this repo and needs no cross-repo coupling.
- Why it matters: `ai_reserve` takes `pg_advisory_xact_lock(hashtext('stoktok.ai_budget'))` (`baseline.sql:405`). A client stuck idle inside a transaction would hold that lock and block every AI reservation.
- Role-level alternative: `postgres/sql/apps/stoktok.sql` in the deployment repo (the optional per-app superuser file, `add-app-db.sh:59-61`, `10-app-dbs.sh:40-42`, precedent `ricotdin.sql`).
  - Use `ALTER ROLE :"app" IN DATABASE :"app" SET idle_in_transaction_session_timeout = '30s'`. It is idempotent.
  - Do not put it in `postgres/sql/app-db.sql`: that file is shared by every app and vendored byte-identical into `scripts/db-check/app-db.sql` (`db/migrations/README.md:17`).
  - A role-level setting also applies to the migrate runner, `pg_restore`, and pgAdmin sessions as `stoktok`. It would affect the runner's per-file transactions only if a gap exceeded the timeout, which `FILE_STATEMENT_TIMEOUT` already bounds. It is a belt-and-braces option, not the primary one.
- Never a migration: `db/migrations/README.md:8` lint forbids role settings and `alter role`.
- The runner uses its own `pg.Client` (`migrate.ts:139`), so the client.ts setting does not reach it. No change needed.

### 11. Optional live-Supabase schema-diff
- Value: modest and informational. The restore into the baseline already re-validates every constraint (baseline CHECKs, FK) and fails loudly on a missing column, in one transaction. The diff mainly shows whether live Supabase had Studio drift before the cutover.
- Implementation:
  - Run `pg_dump --schema-only --schema=public --no-owner --no-privileges --no-tablespaces` with the same PG17 image, over the bridge network.
  - Normalise exactly as `schema-diff.sh:48-50` does (`\restrict` lines, `ENABLE ROW LEVEL SECURITY`, the ROW SECURITY blocks, `-- Dumped from` comments).
  - Also strip `^SET ` and `set_config` lines. The PG15 and PG17 servers emit different SET preambles (for example `transaction_timeout` only on 17).
  - Compare against `A.sql` from `schema-diff.sh` (expected equal) and against `B.sql`/the target (expected difference: `ai_keys` only, as recorded in `work/tickets/STK-083/schema-diff.md`).
- Make it a non-blocking flag (`--schema-check`). The expected live-only noise on Supabase is limited to RLS and grants, which the normaliser and `--no-privileges` already remove.
- It must run outside the `db` network (needs internet) and needs Ming's source credentials, which is why it is optional.

### 12. Open question from the STK-089 security review (ticket.md:43)
- Do not block the app replacement when `migrate` exits 0 with the "ahead" warning.
  - "Ahead" is the designed state when an older image is redeployed (the rollback path): `migrate.ts:173-176`, `db/migrations/README.md:11` and `:12` rely on it.
  - Blocking it would make image rollback impossible.
- Make it visible instead: the deploy should echo the warning line as a workflow annotation.
- The cutover script, unlike the deploy, must assert exact equality (see section 2).

## Recommendations (tie to AC / rule)
1. Script phases `dump | restore | verify | schema-check`, so each leg runs on the right network (AC1; section 1).
2. Pin everything to `pgvector/pgvector:pg17-trixie` (`PG_CLIENT_IMAGE`). Credentials via inherited env, never argv. Dump dir mode 700 under `~/srv/backups/stoktok-cutover/`, not in the offsite-synced tree. bash 3.2-safe (AC1).
3. `pg_dump -Fc --data-only --schema=public --no-owner --no-privileges --exclude-table=public.ai_keys --exclude-table=public.schema_migrations`. Check the TOC against the target table list before restore. Assert `ai_keys` is 0 rows on target (AC1, AC3; section 3).
4. Restore as `stoktok` over `--network db`: `pg_restore --data-only --single-transaction --no-owner --no-privileges` (single-transaction implies exit-on-error), then `ANALYZE` (section 1).
5. Preserve source sequence state. Bump only if `last_value < max`. Compare all six sequences source vs target (section 4).
6. Refuse unless all data tables are empty and `schema_migrations` equals the image's migrations. Force means an explicit `TRUNCATE ... RESTART IDENTITY` and never touches `schema_migrations`. Allow-list the database name (section 5).
7. Verification: pinned session settings, per-row md5 aggregated with `ORDER BY ROW(pk)::text COLLATE "C"`, column list taken from the source, `diff` of `table|count|md5` lines (section 6).
8. Run the migrate runner from the candidate worker image on `--network db`, and fix the runbook so an image exists before the restore (section 2).
9. Backups: add `stoktok` with `add-app-db.sh`, run `/backup.sh` immediately, run `restore-test.sh stoktok` once, and archive the pre-cutover dump out of the retention folders (section 9).
10. `idle_in_transaction_session_timeout` in `client.ts` session init plus a config field. `postgres/sql/apps/stoktok.sql` is the alternative (section 10).
11. Schema diff as an optional `--schema-check` that reuses the `schema-diff.sh` normaliser (section 11).
12. Do not block on "ahead". Annotate it only (section 12).

## Risks
- `setval` is non-transactional, so a failed restore leaves sequences advanced. The empty check must be row-based (section 4).
- Lowering a sequence to `max(id)` could reuse an id referenced elsewhere. Avoid it.
- Source md5 drift if the web app writes after the dump. Stop web and worker, and re-run on mismatch.
- A post-baseline migration landing before cutover breaks naive `t::text` hashing. Use the explicit column list.
- Collation mismatch between Supabase and the container makes the ordered md5 differ spuriously unless it uses `COLLATE "C"`.
- IPv6-only direct Supabase host from a Docker VM. Use the session pooler. Test connectivity in the dry run.
- The cutover dump is an unencrypted copy of the financial data on local disk. Delete it after the rollback window.
- A `pg_dump` or `pg_restore` client other than 17 (brew libpq 18) produces an unreadable archive.
- A cutover started near 02:00 overlaps the nightly sidecar dump. Harmless for correctness (consistent snapshot), but it adds load.
- A role-level `idle_in_transaction_session_timeout` would also hit pgAdmin sessions as `stoktok` if used.

## Open questions
1. Is the candidate worker image buildable and pullable before the deploy (a CI build without a deploy), or must the script run `migrate` from a different image, such as the last main build?
2. Should the web app be stopped during the cutover as well as the worker (writes through server actions)? The ticket says worker only.
3. Where does Ming keep the Supabase connection details for the session pooler (not in the deployment repo, since the Supabase DB secrets are dropped)?
4. Is the `--schema-check` step wanted at all, given that the restore itself fails loudly on any mismatch?
5. `idle_in_transaction_session_timeout` value and home: `client.ts` profile (recommended, 30 s web / 60 s worker) or the deployment repo extras file?
6. Retention of the cutover dump: delete at the end of the proposed 14-day rollback window, or keep one encrypted copy offsite?

Files referenced (absolute):
- /home/user/stoktok/work/tickets/STK-084/ticket.md
- /home/user/stoktok/db/migrations/20261111000200_baseline.sql
- /home/user/stoktok/db/migrations/README.md
- /home/user/stoktok/packages/db/src/pg/migrate.ts
- /home/user/stoktok/packages/db/src/pg/client.ts
- /home/user/stoktok/packages/db/src/pg/config.ts
- /home/user/stoktok/scripts/schema-diff.sh
- /home/user/stoktok/docs/adr/0010-self-hosted-postgres-data-layer.md
- /home/user/stoktok/work/tickets/STK-080/consult-database-optimizer.md
- /home/user/stoktok/work/tickets/STK-083/consult-database-optimizer.md
- /home/user/deployment/postgres/compose.yml
- /home/user/deployment/postgres/sql/app-db.sql
- /home/user/deployment/postgres/scripts/add-app-db.sh
- /home/user/deployment/postgres/init/10-app-dbs.sh
- /home/user/deployment/postgres/config/databases
- /home/user/deployment/ops/backup/RESTORE.md
- /home/user/deployment/ops/backup/restore-test.sh
