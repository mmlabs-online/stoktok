# STK-092 security review

## Attempt 1

**Verdict: no 🔴 findings. Three 🟡 items below, none of them blocking.** I never opened the password file. I checked its format with a count-only regex, and its value appears nowhere in this report.

### Findings

**Password containment (AC 2, AC 4, AC 6, R3, Conventions: Secrets)**
- 🟢 The format is right. `/home/user/deployment/postgres/secrets/apps/stoktok.password` has exactly one line matching `^[0-9a-f]{48}$`. That matches what `openssl rand -hex 24` produces (`add-app-db.sh:28`). It also passes the script's check (`add-app-db.sh:31`) and the init check (`postgres/init/10-app-dbs.sh:31`).
- 🟢 The stoktok repo is clean. I searched all of `/home/user/stoktok` (git-ignored paths skipped) for any standalone 48-hex token and found 0 files. The search covers `docs/deploy.md` and `work/tickets/STK-092/{ticket,plan,impl-log}.md`. Earlier 48-hex substring hits in `scripts/db-check.sh`, `packages/db/src/pg/migrate.test.ts` and `work/tickets/STK-075/impl-log.md` are longer hashes, not this value.
- 🟢 The commit message names only the path (`/home/user/deployment/.git/COMMIT_EDITMSG:1-4`).
- 🟢 The password is not in impl-log or plan. They give the path and counts only (`impl-log.md:7,18,20`).
- 🟢 No logging paths leak it:
  - The script sends the password to psql on stdin through `\set`, never on the command line (`add-app-db.sh:54-61`).
  - psql runs with `-q`, without `-e`/`-a`, so the generated `ALTER ROLE ... PASSWORD` is not echoed (`app-db.sql:6,13-15`).
  - Neither the script nor the workflow ever prints the value. The workflow's `host` step only tests that the file is non-empty with `-s` (`deploy-postgres.yml:72-78`).

**Database list entry**
- 🟢 `/home/user/deployment/postgres/config/databases:5` is `stoktok` on its own line, with a trailing newline, so no names got merged.
- 🟢 The name passes the regex and reserved-name guards (`add-app-db.sh:17-18`). The SQL uses `%I`/`%L` quoting, so there is no injection path.
- 🟢 There is no `postgres/sql/apps/stoktok.sql`, so no superuser extras (extensions, CREATEROLE) are granted. Only `ricotdin.sql` exists.

**What deploy-postgres does after the merge (`.github/workflows/deploy-postgres.yml`)**
- 🟢 Role privileges are minimal. `app-db.sql:10-15` runs `CREATE ROLE stoktok LOGIN`, then `ALTER ROLE ... NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD`.
- 🟢 The role owns only its own database: `CREATE DATABASE stoktok OWNER stoktok` (`:18-22`), then `REVOKE ALL ON DATABASE stoktok FROM PUBLIC` (`:25`). Other app roles therefore cannot connect to it.
- 🟢 The built-in databases are closed too. CONNECT/TEMP on `postgres`/`template1` are revoked from PUBLIC (`:29-30`, repeated from `init/00-lockdown.sql`). `public` schema ownership moves to stoktok and PUBLIC is revoked (`:35-37`).
- 🟢 The run is safe for the existing services:
  - `publish` copies files in place with rsync, then sets the top folder to `chmod 700` (`:93-99`).
  - The secrets and config are directory bind mounts (`compose.yml:48-50,89-90`), so `up -d --wait` recreates nothing.
  - `app databases` runs the idempotent script for each app (`:127-132`). For existing apps it only re-applies their unchanged passwords.
  - No `down`, no pull, and no volume operations.
- 🟢 Only Ming can approve this change: `/postgres/` is under CODEOWNERS (`.github/CODEOWNERS:13`).

**Backups**
- 🟢 The pg-backup sidecar reads the new entry with no restart. `POSTGRES_DB_FILE: /run/pg-config/databases` is re-read on every run (`compose.yml:76-77`).
- 🟢 The offsite sync's freshness loop now includes `stoktok` (`ops/backup/rclone-sync.sh:66-71`).

**Post-merge commands in docs (`/home/user/stoktok/docs/deploy.md:95`)**
- 🟢 `docker compose -p postgres -f ~/srv/postgres/compose.yml exec pg-backup /backup.sh` only execs into the running sidecar. It recreates nothing and puts no password on the command line. The sidecar reads `POSTGRES_PASSWORD_FILE`.
- 🟢 `bash ~/srv/ops/backup/restore-test.sh stoktok` restores into a throwaway container. The container has `--network none`, uses `trust` auth only in that isolated container, and is removed afterwards. It refuses to run if `pgdata` is mounted (`restore-test.sh:34-46`). Its extras path resolves to `~/srv/postgres/sql/apps/stoktok.sql`, which does not exist, so no extra grants are applied.

### Things to fix or verify

- 🟡 **Dump-size floor could fail the offsite sync** (`ops/backup/rclone-sync.sh:68`). The sync also needs each dump to be `-size +1k`. An empty `stoktok` database in custom, compressed format, with only the public-schema owner and ACL entries, may come in just under 1 KiB. If it does, the 03:30 sync fails for every database until STK-094 loads data, even after `/backup.sh` has run.
  - Recommendation (AC 1, Ming verification step 2): after `/backup.sh`, have Ming check the size with `ls -l ~/srv/backups/postgres/daily/stoktok-*.dump`.
  - If it is 1024 bytes or less, accept the failures until the cutover, or handle it in a follow-up. Do not change it in this diff (R7).
  - The TuDoCuaTui precedent, which was probably also an empty database, would show whether this ever happened.
- 🟡 **Not verified (read-only tools, no shell).** The reviewer should run these:
  - **Branch diff:** `git diff --stat origin/main...postgres/add-stoktok` lists exactly the 2 files.
  - **File mode:** `git ls-files -s postgres/secrets/apps/stoktok.password` shows `100644`, like the other app password files. That is acceptable: git does not store tighter modes, and the published copy is protected by the `chmod 700` on `~/srv/postgres`.
  - **PR text:** the PR title and body, once opened, contain only the path.
- 🟡 **Statement logging could capture the password (low risk, already true for every app).** Every deploy-postgres run re-runs `ALTER ROLE ... PASSWORD` for each app. If anyone ever sets `log_statement=ddl|all` on the shared instance, every app password would be written to the Postgres logs. Nothing in this ticket changes that. Possible follow-up for the deployment repo: run that statement with `SET log_statement = 'none'`, or only when the password has changed.

### Risks
- STK-093 (deploy-stoktok building `STOKTOK_DATABASE_URL` from this file) is where the password could actually leak: an env file with the wrong mode, an `echo` of the URL, or `set -x`. That ticket should get this audit.
- Production stays on Supabase. This change only creates an empty database and role.

### Open questions
- Did the TuDoCuaTui empty database ever hit the 1 KiB check in `rclone-sync.sh:68`? If it did, the docs step should warn about it.
