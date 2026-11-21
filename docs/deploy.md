# Deploy runbook (STK-018, STK-037)

Decisions: `docs/adr/0003-deploy-and-scheduling.md`. Drafts for the deployment repo: `deploy/deployment-repo/` (see its README). Only Ming merges.

## Flow
A push to a branch `release/X.Y.Z` (its commit must already be on main) runs `release.yml`: it releases exactly `vX.Y.Z` (new, higher than every existing tag), creates and pushes that git tag, builds and pushes `stoktok-web` and `stoktok-worker`, then it opens PR `release/stoktok-vX.Y.Z` on `mmlabs-online/deployment` (only `apps/stoktok/release.env`, both images pinned by digest). Merging it runs `deploy-stoktok` on `macbook-runner`: pull, then (when the release's compose has a `migrate` service) a pre-migration dump and `migrate`, then `up -d --wait` on the compose health check (`/readyz`, which pings the database, from the cutover release on; `/healthz` before), then publish compose, `release.env` and the job scripts to `/Users/mingming/stoktok/current`. A launchd job reads that directory and runs the worker jobs.

## Placeholders and gates
| Placeholder | Value | Status |
|---|---|---|
| `APP_HOSTNAME` | `stoktok.mmlabs.online` | confirmed by Ming (G2). Set only in the Cloudflare dashboard; no file in either repo holds it |
| Log dir (`STOKTOK_LOG_DIR`) | `/Users/mingming/stoktok/logs` | default |

- **G1:** the Cloudflare Access application exists and is verified **before** any public hostname for `stoktok-web:3000` is added. It is a step of the v0.1.0 cut below.
- No auth code is in the app (R6 suspended). Access is the only gate until STK-004.

## Preconditions on the Mac
- **D1:** the runner, the Docker engine (OrbStack, set to start at login) and the scheduler all run as `mingming`, in that user's login session. `mingming` must be logged in (auto-login after a reboot). Check: reboot, let it auto-login, run the `runner-check` workflow and see it green. No deploys or jobs run without the session.
- **D2:** time zone is Asia/Ho_Chi_Minh (`sudo systemsetup -gettimezone`; `run-schedule.sh` refuses to run if `date +%z` is not `+0700`). Sleep is off (`sudo pmset -a sleep 0 disablesleep 1`, or lid open on power), otherwise deploys queue and jobs coalesce on wake.
- **D3:** the Mac is Intel, so the `linux/amd64` images run natively.
- **D4:** secrets file `/Users/mingming/.config/stoktok/stoktok.env`, mode 600, owner `mingming`, outside git and the runner checkout. It holds every key of the env list below (optional ones may be empty). It is written by `deploy-stoktok` on every run from the `stoktok` environment secrets. Do not edit it by hand: the next deploy overwrites it. It sits in a personal home directory: `deploy-stoktok` creates the directory with mode 700 and excludes it from Time Machine; keep the backup destination encrypted.
- **D5:** deployment `main` is protected: PR required, code-owner review, `pr-scope` required, no admin bypass. The `stoktok` secrets reach a job on the self-hosted runner, so this protection is what stands between a push and the key. Side effect: without a `github-actions` bypass, an automatic rollback ends in `restore-unpushed` (the server is restored, the run is red, and Ming reverts the release PR by hand).

## Repository secrets
In the stoktok repo (Settings, Secrets and variables, Actions):
- `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`: push to `mingming21400/stoktok-*`.
- `DEPLOY_REPO_TOKEN`: fine-grained PAT on `mmlabs-online/deployment` only. Contents read/write, Pull requests read/write.

## Deployment repo: environment `stoktok`
Create it **before** merging the setup PR. Otherwise GitHub creates the environment on the fly with no branch rule and no secrets.
1. `mmlabs-online/deployment`, Settings, Environments, New environment `stoktok`.
2. Deployment branches and tags: selected branches, `main` only. This is the control GitHub enforces; the `if: github.ref == 'refs/heads/main'` guard in the workflow is not one on its own, because a manual run uses the workflow file of the chosen branch.
3. Environment secrets, prefixed `STOKTOK_` because the deployment repo is shared by every mmlabs app: `STOKTOK_SUPABASE_URL` (`https://<ref>.supabase.co`, no trailing slash or path) and `STOKTOK_SUPABASE_SERVICE_ROLE_KEY` (the **new** key, not the one pasted into chat on 2026-11-01). The workflow writes them into the env file as `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, the names the app reads.
   `STOKTOK_AI_KEYS_MASTER_KEY` (STK-084, required) is the AI keyring master key: 32 random bytes in base64 (`head -c 32 /dev/urandom | base64`, 44 characters ending in `=`). Keep a copy in the password manager; never put it in the deployment repo. It is written under the same name. The database URL is not a secret of this environment: see Shared Postgres below.
   Auth (STK-004, STK-048) adds two more. Authen is Supabase Auth of the stoktok project itself: `STOKTOK_AUTHEN_SUPABASE_URL` = the stoktok project URL (same value as `STOKTOK_SUPABASE_URL`, `https://<ref>.supabase.co`, no path), `STOKTOK_AUTHEN_SUPABASE_ANON_KEY` = the stoktok project's anon or `sb_publishable_` key (never the service role key). They are written as `AUTHEN_SUPABASE_URL` and `AUTHEN_SUPABASE_ANON_KEY`.
   Two optional AI secrets (STK-072): `STOKTOK_ANTHROPIC_API_KEY` and `STOKTOK_GOOGLE_AI_API_KEY`, written as `ANTHROPIC_API_KEY` and `GOOGLE_AI_API_KEY`. Unset means that provider is off.
4. No repo-level secrets with the same names (environment secrets would quietly override them). No required reviewers: the PR merge is already the gate.
5. Fallback if the org plan has no environments on a private repo: store both as repo-level Actions secrets and remove the `environment: stoktok` line in the deployment PR before merging. The `main` guard, the fail-safe and D5 stay. Weakness: any workflow on any branch can read repo-level secrets. Record a follow-up to restore the line when the plan allows.

If a *required* secret is empty or malformed, `deploy-stoktok` stops at the `secrets` step, names the secret, starts nothing and leaves the old file in place.

## Setup
Create the `stoktok` environment and its secrets (section above), then Ming merges the deployment-repo setup PR (drafts in `deploy/deployment-repo/`, plus the CODEOWNERS line). Merging runs `deploy-stoktok` because `compose.yml` changed under `apps/stoktok/`. With no `release.env` it skips the deploy and the publish, but still runs `preflight` and `envdir`; the LaunchAgent is installed by the first release deploy (nothing is published before that, so a scheduler would have nothing to run).

### Done by the workflow (no root, every run, idempotent)
- **Env dir and Time Machine (D4):** `envdir` creates `~/.config/stoktok` with mode 700, checks owner and mode, runs `tmutil addexclusion` and verifies it with `tmutil isexcluded` (falling back to the `xattr` exclusion). It runs before the env file is written. If the exclusion cannot be verified, the run stays green with a warning and a suffix on the PR comment. Check: the run is green, and `ls -l ~/.config/stoktok/stoktok.env` shows `-rw------- mingming`.
- **Log dir and LaunchAgent (old steps 2 and 3):** after a successful publish, `agent` creates `~/stoktok/logs`, copies the published plist (`$SCHED_DIR/online.mmlabs.stoktok.jobs.plist`) to `~/Library/LaunchAgents`, and loads it with `launchctl bootstrap gui/$(id -u)` only when it is new or changed. It then verifies with `launchctl print`. A re-run with no change prints `scheduler unchanged`. A plist change while a job runs stops that job (jobs are idempotent). If `agent` fails the run is red and the PR comment says "Scheduler NOT installed"; the web deploy is not rolled back.
- **Read-only report:** `preflight` writes the login session, OrbStack socket, docker engine and any old LaunchDaemon to the run summary.

### Still needs Ming at the Mac
- D1: auto-login for `mingming` and OrbStack set to start at login.
- D2: time zone and sleep settings.
- Remove an old LaunchDaemon if `preflight` reports one: `sudo launchctl bootout system/online.mmlabs.stoktok.jobs` and `sudo rm /Library/LaunchDaemons/online.mmlabs.stoktok.jobs.plist`.
- FileVault, and an encrypted Time Machine backup destination.
- Optional log rotation: a line for `/Users/mingming/stoktok/logs/*.log` in `/etc/newsyslog.d/stoktok.conf` (owner `mingming:staff`).

## Restore auth (STK-004) - order
1. **Access control (required, STK-060).** The app has no allowlist: **any user in the stoktok project's Auth gets full access** (Ming accepted this, 2026-11-07). The only thing keeping it to one user is this checklist. Cloudflare Access stays in front. One-time, in the stoktok project's Supabase dashboard (Authentication), all items required:
   - Sign In / Providers: Email enabled; "Allow new users to sign up" **off**.
   - Anonymous sign-ins **off**.
   - Every other provider **off** (phone, all OAuth, SSO/SAML).
   - "Confirm email" **on**.
   - Minimum password length 12 or more; leaked-password protection **on** if the plan offers it.
   - Site URL and Redirect URLs: `https://<APP_HOSTNAME>` only.
   - Users, Add user, Create new user: Ming's email and a strong password, auto-confirm on.
   - Then check Authentication, Users: it must list **only** Ming. Re-check after any change to the Supabase project.
2. Ming sets `STOKTOK_AUTHEN_SUPABASE_URL` and `STOKTOK_AUTHEN_SUPABASE_ANON_KEY` in the deployment repo environment `stoktok` (values: see the environment section above).
3. Ming merges the deployment-repo PR that carries the updated `deploy-stoktok.yml`. A workflow-file change alone does not deploy (the paths filter is `apps/stoktok/**`), so run `workflow_dispatch` on `main` once to rewrite `stoktok.env`.
4. Only then cut the release that contains STK-004.

If step 3 runs before step 2, `deploy-stoktok` stops at `secrets`, names the missing secret and starts nothing. If a STK-004 image runs without the env, `/healthz` stays 200 and every page redirects to `/login`, where sign-in fails: Ming is locked out, nothing is exposed.

## Remove the allowlist (STK-060) - order
Only if an auth image (STK-004 to STK-059) has already been released. Do these in order:
1. Merge STK-060 and release the new image **while the deployment repo still runs the old workflow** (it still writes `ALLOWLIST_USER_IDS`; the new image ignores it).
2. Then merge the deployment-repo PR with the new `deploy-stoktok.yml`.
3. Only then delete `STOKTOK_ALLOWLIST_USER_IDS` from the `stoktok` environment.

Why: a pre-STK-060 auth image under the new workflow throws in `loadAuthConfig` on every request. `/healthz` stays 200, so the deploy looks healthy and does not roll back, but nobody can log in.

**Rollback warning:** after step 2, do not roll back to a pre-STK-060 image that has auth (STK-004 or later). If you must, re-add the secret and the old workflow first.

If no auth image has been released yet, skip the allowlist secret entirely and ship STK-060 together with the auth setup above.

## Enable AI keys (STK-072)
`deploy/deployment-repo/` is only a draft mirror; nothing here deploys by itself. Steps 1 and 2 can go in either order: an old workflow with a new image means the keys are absent, so AI is off; a new workflow with no secrets writes `K=`, so AI is off. Either way there is no lockout.
1. In `mmlabs-online/deployment`, Settings, Environments, `stoktok`: optionally add `STOKTOK_ANTHROPIC_API_KEY` and/or `STOKTOK_GOOGLE_AI_API_KEY`. Leaving one out disables that provider. Do not create repo-level secrets with the same names. Values must match `^[A-Za-z0-9._-]*$`: no spaces or newlines, and a whitespace-only value fails the run.
2. Open a deployment-repo PR from a non-`release/*` branch that copies the updated `.github/workflows/deploy-stoktok.yml` as-is, then merge it.
   The STK-093 deployment PR (Shared Postgres below) carries these workflow lines; once it is merged, steps 2 and 3 are done and need no separate PR or dispatch.
3. A workflow-only change does not trigger a deploy (the paths filter is `apps/stoktok/**`). Run `deploy-stoktok` via `workflow_dispatch` on `main` once. It rewrites `stoktok.env` (expect `changed=true` and a one-time force-recreate of web).
4. Check: `ls -l ~/.config/stoktok/stoktok.env` still shows `-rw------- mingming`. Do not print the file.
5. After any later key change or rotation, run `workflow_dispatch` on `main` again.

## Shared Postgres (STK-084)
App data moves from Supabase to the shared mmlabs Postgres 17 (`postgres:5432` on the Docker network `db`, database and role `stoktok`). **Production stays on the Supabase-backed release (v0.2.1) until the cutover; cut the release only as part of the cutover runbook below (STK-096; the release itself is STK-094).** Order:
1. B (STK-092): in the deployment repo run `bash postgres/scripts/add-app-db.sh stoktok`, merge, wait for `deploy-postgres` green, then run one backup so the offsite sync does not report a false failure (`docker compose -p postgres -f ~/srv/postgres/compose.yml exec pg-backup /backup.sh`) and `bash ~/srv/ops/backup/restore-test.sh stoktok` once (must exit 0).
2. C (STK-093): the deployment PR copies `apps/stoktok/compose.yml` and `.github/workflows/deploy-stoktok.yml` from the drafts. It touches `apps/stoktok/`, so merging it starts `deploy-stoktok` by itself (no `workflow_dispatch`).
   - **Before merging:** the `stoktok` environment lists `STOKTOK_AI_KEYS_MASTER_KEY` (required). Check whether `STOKTOK_ANTHROPIC_API_KEY` / `STOKTOK_GOOGLE_AI_API_KEY` exist, because they reach the containers for the first time. Preferably B's `deploy-postgres` run is green. Merge outside 18:30-19:30 and 21:00-22:00 Mon-Fri (job slots).
   - **What happens:** `secrets` rewrites the env file (8 names, mode 600, `STOKTOK_DATABASE_URL` derived from `postgres/secrets/apps/stoktok.password`; every `SUPABASE_*` line stays for the 14-day rollback window). `pull` finds no `migrate` service, so `backup` and `migrate` are skipped. `deploy` recreates web (v0.2.1) on `web` + `db`, so expect seconds of downtime; it must turn healthy (`/healthz` touches no DB, so the `stoktok` role need not exist yet). `publish` copies the compose for the launchd jobs. A bad secret or password file fails `secrets` before anything starts; fix it and run `workflow_dispatch` on `main`.
   - **Checks (Ming, never print the env file; `docker inspect` only with `-f`):** `ls -l ~/.config/stoktok/stoktok.env` shows `-rw-------`; `cut -d= -f1` of it lists the 8 names; `docker compose -p stoktok ps` shows web healthy with a new start time; the networks come from `docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' $(docker compose -p stoktok ps -q stoktok-web)` and must list `db` and `web`; the site still shows the same data; `/Users/mingming/stoktok/current/run-job.sh eod-prices --dry-run` exits 0; after `pg-backup /backup.sh`, report the size of `~/srv/backups/postgres/daily/stoktok-*.dump`.
   - **Rollback:** the workflow restores the previous `apps/stoktok/` if web is not healthy within 120 s, but its revert push is refused on a protected `main` (`restore-unpushed`), so then revert the PR's merge commit in a PR. The Supabase project and the empty `stoktok` database are not affected.
   - **Rotating `stoktok.password`:** `deploy-stoktok` does not run when only `postgres/secrets/apps/stoktok.password` changes (its paths filter is `apps/stoktok/**`), so web and worker would keep the old password. Once `deploy-postgres` is green, run `deploy-stoktok` via `workflow_dispatch` on `main`; it rewrites the env file and recreates web.
3. Cutover (STK-094): the data move (`scripts/db-migrate-from-supabase.sh`, next section) and the first Postgres release, run by the step-by-step "Cutover runbook (STK-096)" below. The release and its compose are described in "Cutover release (STK-094)" just after this list.

The draft compose is in its cutover state (STK-094): web on `tunnel` and `db`, the worker on `default` and `db` (`db` is internal, so the worker keeps `default` for market-data egress), a one-shot `migrate` service on `db` only, and the web health check on `/readyz`, which pings the database. It reaches the deployment repo only through the cutover release PR; production keeps the expand compose (health check `/healthz`) until runbook stage 4. `/healthz` does not test the DB. `/readyz` is public like `/healthz` and memoises its DB ping for 3 s; like `/healthz` it must never get a Cloudflare Access bypass (a bypass would let anyone reach it; the memo only caps the DB load).

### Cutover release (STK-094)
The cutover release is a normal release (v0.3.0, or the next free version) plus one extra commit on its deployment PR:
1. Review `git log v0.2.1..origin/main` first (STK-094 impl-log has the table), and hold unrelated stoktok merges until the release is cut.
2. Cut it as in "Cut a release": push `release/X.Y.Z` from the merge commit of the STK-094 PR. Pick a version that has no tag and no remote branch yet. Right after `release.yml` opens the deployment PR, and before the compose commit, convert it to a draft: `gh pr ready --undo <n> --repo mmlabs-online/deployment` (GitHub refuses to merge a draft, so an early merge cannot put production on the empty `stoktok` database). If the orchestrator's token cannot convert it, Ming does it at runbook stage 0.3.
3. On the deployment branch `release/stoktok-vX.Y.Z`, add a second commit that makes `apps/stoktok/compose.yml` byte-equal to `deploy/deployment-repo/apps/stoktok/compose.yml` at the tag (`git show vX.Y.Z:deploy/deployment-repo/apps/stoktok/compose.yml`). `pr-scope` allows any change under `apps/stoktok/`. Do not copy the workflow.
4. Check `gh pr diff <n> --repo mmlabs-online/deployment --name-only` lists exactly `apps/stoktok/compose.yml` and `apps/stoktok/release.env`, and `cmp` of the branch file against the tag's draft shows no difference. Pushing to a non-main branch deploys nothing.
5. The PR stays a draft (step 2). Ming marks it ready at runbook stage 4.1 (`gh pr ready <n> --repo mmlabs-online/deployment`). Do not merge before runbook stage 4. Never put this compose in a setup PR while v0.2.1 is pinned: v0.2.1 has no `migrate` command and no `/readyz`.
6. If the dry run (stage 1) fails and needs a code fix, close the PR unmerged, fix through a ticket, cut the next version and repeat step 3. If `release.yml` fails after the tag step, the version is consumed: use the next one.

## Data move script (STK-091)
`scripts/db-migrate-from-supabase.sh` is the one-time move of the Supabase `public` data into the shared Postgres. It runs on the Mac from a checkout of the release tag. This section is the reference; the ordered runbook (dry run, freeze, move, release, verification, rollback, day +14) is "Cutover runbook (STK-096)" below.

```
scripts/db-migrate-from-supabase.sh --target <db> (--worker-image <ref> | --skip-migrate)
    [--dry-run] [--schema-check] [--force --confirm <db>] [--keep-dump] [--verify-only] [--work-dir <dir>]
```
- Inputs are environment variables (names only; none of them is app env, none goes in the env table above):
  - Source: `MOVE_SRC_HOST`, `MOVE_SRC_PORT` (5432), `MOVE_SRC_USER`, `MOVE_SRC_DB` (postgres), `MOVE_SRC_SSLMODE` (require), `MOVE_SRC_PGPASSWORD` (optional; without it the script prompts on the terminal and exits 2 if there is none). Use the Supabase session pooler or the direct host on port 5432. `MOVE_SRC_SSLROOTCERT` (optional, absolute path of the Supabase root certificate) is mounted read-only into the source legs only; it needs `MOVE_SRC_SSLMODE` `verify-ca` or `verify-full`, and those modes need it (exit 2 otherwise, also for a missing file or one without a PEM certificate).
  - Target: `MOVE_DST_HOST` (postgres), `MOVE_DST_PORT` (5432), `MOVE_DST_USER` (stoktok), `MOVE_DST_PWFILE` (default `~/srv/postgres/secrets/apps/stoktok.password`).
  - Containers and freeze checks: a remote source also needs `--worker-image` pinned by digest (`<repo>[:tag]@sha256:<64 hex>`, exit 2 otherwise); stages 1 and 3 use the digest-pinned `STOKTOK_WORKER_IMAGE` from the release PR. `PG_CLIENT_IMAGE` (default `pgvector/pgvector:pg17-trixie`; a source host other than `localhost`/`127.0.0.1` needs it pinned as `<repo>@sha256:<64 hex>`, else exit 2), `MOVE_SRC_NETWORK` (bridge), `MOVE_DST_NETWORK` (db), `MOVE_JOB_LOCK` (`/tmp/stoktok-jobs.lock`), `MOVE_FREEZE_PROJECT` (stoktok).
- Passwords never appear on a command line: pg clients read a private pgpass file (mode 600, in a mode 700 temp dir) that is deleted on exit, including on INT, TERM and HUP. The migrate container gets the target database URL, password included, in its environment (`-e STOKTOK_DATABASE_URL`), so `docker inspect` shows it for the container's lifetime, like the long-running worker's. After a killed run (SIGKILL, power loss) check `$TMPDIR` (on macOS usually `/var/folders/.../T/`; `/tmp` only if it is unset; run `echo $TMPDIR` in the session that ran the script) for a leftover `tmp.*/pgpass` and delete it; it holds both passwords.
- `--dry-run` needs a scratch target (`stoktok_scratch...`), always runs the schema check (differences make the verdict FAIL, exit 1; a difference in columns can make the restore itself fail first, which also exits 1), only warns on freeze problems and deletes the dump unless `--keep-dump`, also when the dry run fails after the dump. A real run targets `stoktok` (or a scratch name), blocks on freeze problems, runs the schema check only with `--schema-check` (informational, never changes the exit code) and keeps the dump.
- Steps: freeze checks (job lock dir, running containers of the compose project), preflight (prints `current_database`, `current_user`, `server_version_num`; refuses a superuser or Postgres below 17), assert `schema_migrations` equals `db/migrations` (after `migrate` from `--worker-image`, or as is with `--skip-migrate`), refuse a non-empty target (unless `--force --confirm <db>`, which truncates every public table except `schema_migrations`), `pg_dump` (data only, no `ai_keys`, no `schema_migrations`) and a table-of-contents check, `pg_restore --single-transaction`, `ANALYZE`, sequence check (dump state kept, bumped only when behind `max(id)`; exactly 6 identity sequences expected), then a count and ordered md5 comparison per table between source and target. `ai_keys` must be empty on the target.
- `--verify-only` re-runs only the schema assertion and the comparison, without writes.
- Outputs in the work dir (default `~/srv/backups/stoktok-cutover`, mode 700): `verify-source.txt`, `verify-target.txt` (names, counts, hashes), `schema-check.diff` (DDL only) and, in a real run, the dump. The dump (mode 600) is unencrypted financial data and is not offsite-synced: delete it when the 14-day rollback window closes (STK-095).
- Exit codes: 0 success, 1 failure (the failing step is printed), 2 usage error (nothing was contacted).
- The script refuses a target host:port equal to the source host:port, and a source database name equal to the target database name. These are two string comparisons only: they do not detect aliases (another hostname, an IP or a proxy for the same server). Check `MOVE_SRC_HOST` yourself. The verify step reads the target in a read-only transaction too.
- It never writes to Supabase and never applies a migration there: the source is reached only by `pg_dump` and by `SELECT`s in a read-only transaction that is rolled back.
- Tests: `pnpm test:move` (needs docker and `MOVE_TEST_URL`, a throwaway local Postgres); CI runs it.

## Cutover runbook (STK-096)
One-time. Production runs v0.2.1 on Supabase until stage 4. Rollback window: 14 days; data written after the cutover is re-entered by hand, so prefer fixing forward (Ming, 2026-11-17). Supabase is only read, by the script; its `public` tables stay as a read-only archive. Run docker as `mingming`; `docker inspect` only with `-f`; never print the env file or a password.

For read-only checks on the **shared Postgres** (the `stoktok` DB, superuser over the container's local socket, read-only transaction), define once in the session:
```
pgro() { printf '%s\n' 'begin transaction read only;' "$1;" 'rollback;' | docker compose -p postgres -f ~/srv/postgres/compose.yml exec -T postgres psql -U postgres -d stoktok -X -q -A -t -v ON_ERROR_STOP=1; }
```

### 0. Preconditions
Tick each in `work/ming-todo.md`.
1. `macbook-runner` online; `deploy-postgres` #9 (STK-092) and `deploy-stoktok` #10 (STK-093, expand) green, and their checks in the to-do ticked (first backup, restore-test, 8 env names, web on `db web`, `eod-prices --dry-run`).
2. STK-090 merged, or waived by Ming (ADR 0010).
3. STK-094 done: the release `vX.Y.Z` is cut and its deployment PR `release/stoktok-vX.Y.Z` is **open, not merged, and a draft** (`gh pr view <n> --repo mmlabs-online/deployment --json isDraft` says `true`). The PR changes exactly two files, `apps/stoktok/release.env` and `apps/stoktok/compose.yml` (`gh pr diff <n> --repo mmlabs-online/deployment --name-only`), and its `pr-scope` check is green. The compose commit equals the draft at the tag (see "Cutover release (STK-094)"); it adds the `migrate` service and the `/readyz` health check. `git log v0.2.1..vX.Y.Z` has been skimmed, and no unrelated merges went in after it.
4. Worker image: `STOKTOK_WORKER_IMAGE` from that PR's `release.env` (digest-pinned), exported as `WORKER_IMAGE`. `docker pull "$WORKER_IMAGE"` succeeds on the Mac.
5. Checkout of the tag outside the runner's work dir: `git clone --branch vX.Y.Z --depth 1 <stoktok repo> ~/stoktok-cutover-src` (or `git checkout vX.Y.Z` in an existing clone). `git describe --tags --exact-match` prints `vX.Y.Z`. The script compares the image's migrations with this checkout and stops with "the worker image migrations differ from this checkout" otherwise.
6. Client image pinned by digest (a remote source without it exits 2 with "PG_CLIENT_IMAGE must be pinned by digest"):
   - `docker image inspect -f '{{join .RepoDigests "\n"}}' pgvector/pgvector:pg17-trixie` shows the `pgvector/pgvector@sha256:<digest>` line.
   - It is the image the shared Postgres runs when `docker inspect -f '{{.Image}}' $(docker compose -p postgres -f ~/srv/postgres/compose.yml ps -q postgres)` equals `docker image inspect -f '{{.Id}}' pgvector/pgvector:pg17-trixie`. If the IDs differ, take the digest of the image the running Postgres uses: `docker image inspect -f '{{index .RepoDigests 0}}' "$(docker inspect -f '{{.Image}}' $(docker compose -p postgres -f ~/srv/postgres/compose.yml ps -q postgres))"`, and export that as `PG_CLIENT_IMAGE`.
   - `export PG_CLIENT_IMAGE=pgvector/pgvector@sha256:<digest>`.
7. Supabase source details, kept in the password manager and never in a file: session pooler host `aws-0-<region>.pooler.supabase.com`, port 5432, user `postgres.<ref>`, database `postgres`, and the DB password (reset it in the dashboard if unknown; that does not affect the API keys). Export only `MOVE_SRC_HOST` and `MOVE_SRC_USER`. Let the script prompt for the password; do not export `MOVE_SRC_PGPASSWORD`, which lands in shell history.
8. Optional TLS verification (F7). Download the Supabase root certificate (Project Settings, Database, SSL configuration) to an absolute path without spaces, e.g. `~/srv/backups/stoktok-cutover/supabase-ca.crt`, then `export MOVE_SRC_SSLROOTCERT=<that path> MOVE_SRC_SSLMODE=verify-full`. The script mounts it read-only into the source legs only. If the dry run fails on the certificate, try `verify-ca` with the same file; if that fails too, first download the certificate again from the dashboard and check `MOVE_SRC_HOST` against the dashboard's pooler string. A failed certificate check is what a man-in-the-middle looks like. Only then unset both (default `require`), and treat the Supabase DB password as exposed: rotate it as in stage 7.1 after the last script run, whatever the outcome (also after an aborted cutover or a rollback).
9. Work dir: `mkdir -p -m 700 ~/srv/backups/stoktok-cutover`, then `tmutil addexclusion ~/srv/backups/stoktok-cutover` and `tmutil isexcluded ~/srv/backups/stoktok-cutover` (must say excluded). The offsite sync covers only `~/srv/backups/postgres/{daily,weekly,monthly}` (deployment `ops/backup/RESTORE.md`); never add `~/srv/backups` to a sync.
10. Session: run every script call inside `tmux new -s cutover` (or `screen`), so an SSH drop cannot HUP a real run halfway, and call it as `/bin/bash scripts/db-migrate-from-supabase.sh ...` from the tag checkout (macOS bash 3.2).

### 1. Dry run
Any day before the cutover, ideally the same week; production keeps running.
1. `docker compose -p postgres -f ~/srv/postgres/compose.yml exec -T postgres psql -U postgres -c "create database stoktok_scratch owner stoktok" -c "revoke all on database stoktok_scratch from public"` (shared Postgres only).
2. `/bin/bash scripts/db-migrate-from-supabase.sh --dry-run --target stoktok_scratch --worker-image "$WORKER_IMAGE"`. This also tests the `--worker-image` leg. Freeze problems only warn here.
3. Expected: `schema_migrations matches db/migrations`, `schema check: no unexpected differences`, `sequences: 6 identity sequences, N bumped`, `verified N tables, M rows; ai_keys is empty on the target`, `dry run OK`. Note N, M and the bumped sequences.
4. `dry run FAIL: schema check found differences`: read `~/srv/backups/stoktok-cutover/schema-check.diff` (DDL only) and send it to the agent. The schema check is mandatory in the dry run (D4); do not cut over.
5. Any other `FAILED at step: <step>`: send the output (it holds no passwords) to the agent.
6. Drop it: `docker compose -p postgres -f ~/srv/postgres/compose.yml exec -T postgres psql -U postgres -c "drop database stoktok_scratch with (force)"`.
7. Leftovers: a dry run deletes its dump, also on failure, unless `--keep-dump` (then `dump kept:` names it). After `--keep-dump` or a killed run delete `~/srv/backups/stoktok-cutover/stoktok-supabase-*.dump`. After a killed run also delete any `tmp.*/pgpass` under `$TMPDIR` of that shell (see "Data move script").

### 2. Freeze
Cutover day.
1. Window: Saturday or Sunday daytime, or Friday after the 21:00 run has finished (`tail -n 2 /Users/mingming/stoktok/logs/signals.log` shows an `end job=signals exit=...` line timestamped after today's 21:00 run started; timestamps are UTC, so 14:00Z). Never 18:30-19:30 or 21:00-22:00 Mon-Fri; stay away from 02:00 (pg-backup) and 03:30 (offsite sync).
2. Before stopping anything, note 3-4 dashboard totals (holdings value, P&L, number of transactions), the fee rate on Settings and the AI spend if Settings shows it. A screenshot is fine.
3. Scheduler: `launchctl bootout gui/$(id -u)/online.mmlabs.stoktok.jobs`; then `launchctl print gui/$(id -u)/online.mmlabs.stoktok.jobs` must fail.
4. No job running: `test ! -d /tmp/stoktok-jobs.lock`, and `docker ps --filter label=com.docker.compose.project=stoktok` lists only `stoktok-web`. If a job runs, wait for it; do not kill it.
5. Web: `docker compose -p stoktok stop stoktok-web` (fallback: `docker stop <container name from docker ps>`). `docker ps --filter label=com.docker.compose.project=stoktok` then prints no container. The site shows a Cloudflare 502, which is expected.
6. Until stage 4 is finished: no reboot, no OrbStack restart, no deployment-repo merge. Any merge under `apps/stoktok/` runs `deploy-stoktok`, which restarts web and reloads the scheduler.

### 3. Move
1. `/bin/bash scripts/db-migrate-from-supabase.sh --target stoktok --worker-image "$WORKER_IMAGE" --schema-check`. The schema check is informational at the cutover (D4). "freeze the apps first" means go back to stage 2.
2. Expected: `current_database=stoktok current_user=stoktok`, `schema_migrations matches db/migrations`, `sequences: 6 identity sequences, ...`, `verified N tables, M rows; ai_keys is empty on the target` (N as in the dry run, M at least as large), `dump kept: ...` and `move OK`. Note the dump path.
3. Ledger baseline: `pgro "select coalesce(max(id),0) || '|' || count(*) from ai_usage"`. Note it.
4. On failure:
   - `verification failed; writers may be running`: check the freeze, then `/bin/bash scripts/db-migrate-from-supabase.sh --target stoktok --verify-only`.
   - A failure after the restore leaves `stoktok` non-empty ("is not empty"). A retry needs `--force --confirm stoktok` (truncates every table except `schema_migrations`).
   - Not solvable now: see rollback "Move failed".

### 4. Release
1. Mark the STK-094 release PR ready (`gh pr ready <n> --repo mmlabs-online/deployment`), merge it and watch `deploy-stoktok`: `pull` (migrate service found); `backup` (pre-migration dump of every DB); `migrate` printing `up to date` (the move already applied the schema; anything else, e.g. "applied ...", is unexpected: report it); `deploy` healthy on `/readyz` within 120 s; `publish`; `agent` reinstalls the scheduler, which ends the freeze. The PR comment says `deployed: ... vX.Y.Z ... healthy`, with no "Scheduler NOT installed" and no "Database is ahead". Do not use the site until that deploy comment arrives: the new web is on the tunnel during the up-to-120 s `--wait`, and a write in that window would be lost if the deploy is restored. During the freeze, ignore the workflow's "the old release is still running"; web is stopped.
2. Copy the pre-migration dump out of the 24 h `last/` retention: `cp "$(ls -t ~/srv/backups/postgres/last/stoktok-[0-9]*.dump | head -n 1)" ~/srv/backups/stoktok-cutover/ && chmod 600 ~/srv/backups/stoktok-cutover/stoktok-*.dump`. The copied file's name (`stoktok-YYYYMMDD-HHMMSS`) must be later than the stage 4.1 merge time, or `ls -l` must show a modification time after the merge; otherwise report it and do not continue to stage 5.
3. Failure: see rollback "Release".

### 5. Verify and smoke
Before the next job slot. The script already compared every table's count and ordered md5 with Supabase, `ai_usage` and `ai_summaries` included, so no manual Supabase query is needed.
1. `docker compose -p stoktok ps`: web healthy, new start time.
2. `docker compose -p stoktok exec stoktok-web node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>r.text()).then(console.log)"` shows `vX.Y.Z`; the same with `/readyz` shows `{"status":"ok"}`.
3. `curl -sI https://<APP_HOSTNAME>/readyz` without a session gets the Access redirect (302/403), not 200.
4. Log in at `https://<APP_HOSTNAME>/login` (Auth is still Supabase). The dashboard totals, the transaction count and the fee rate equal the stage 2 notes.
5. One write: add a test transaction (or change and restore a setting), check it shows, then delete it.
6. `launchctl print gui/$(id -u)/online.mmlabs.stoktok.jobs` succeeds.
7. Jobs:
   - `/Users/mingming/stoktok/current/run-job.sh eod-prices --dry-run` exits 0.
   - Note `pgro "select (select count(*) from prices_daily) || '|' || (select count(*) from financials) || '|' || (select count(*) from signals) || '|' || (select count(*) from data_gaps) || '|' || (select count(*) from news)"` and `pgro "select data_type || '|' || count(*) from data_gaps where resolved_at is null group by data_type order by 1"`.
   - Run `run-job.sh eod-prices`, `financials`, `signals`; then `eod-prices` and `signals` again. The counts after the second run equal those after the first. New open gaps appear only for days the source really lacks; downtime does not create gaps.
   - `tail /Users/mingming/stoktok/logs/eod-prices.log` shows `exit=0` and `vX.Y.Z`. `news` is not scheduled; run `run-job.sh news` only to check it.
8. Logs: `docker compose -p stoktok logs stoktok-web 2>&1 | grep -c ai_keyring_invalid` prints 0, and `grep -l 'ai_keyring_invalid\|lock timeout' /Users/mingming/stoktok/logs/*.log` prints nothing.
9. Next morning: `ls -l ~/srv/backups/postgres/daily/stoktok-*.dump` shows today's dump, larger than the empty-DB one; the 03:30 offsite sync is healthy.

### 6. AI keys
1. Issue new keys at Anthropic and Google AI Studio and enter them on Settings.
2. Trigger one AI action. `pgro "select max(id) from ai_usage"` is above the stage 3 baseline, and the Settings spend equals the old spend plus the new row.
3. If the `stoktok` environment has `STOKTOK_ANTHROPIC_API_KEY` or `STOKTOK_GOOGLE_AI_API_KEY` holding an old key (env fallback, ADR 0011), replace or delete it, then run `deploy-stoktok` via `workflow_dispatch` on `main` (the environment allows `main` only).
4. Revoke the old keys at both providers.
5. Repeat the `ai_keyring_invalid` greps of stage 5.8 now and the next day: 0 and nothing.

### 7. After a successful cutover
1. Reset the Supabase database password (dashboard, Project Settings, Database) and store it in the password manager. Nothing deployed uses it (v0.2.1 and Auth use the API keys); a script re-run after a rollback needs the new one.
2. `ls -d $TMPDIR/tmp.*` shows no leftover `pgpass` dir.
3. If `MOVE_SRC_PGPASSWORD` was exported despite stage 0, remove it from the shell history. Exit the `tmux` session.

### 8. Rollback per stage
| Stage | Do | What is lost |
|---|---|---|
| Dry run | Drop `stoktok_scratch` (stage 1.6). | Nothing; production is unchanged. |
| Freeze | `docker compose -p stoktok start stoktok-web` (fallback `docker start`); `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/online.mmlabs.stoktok.jobs.plist`, then `launchctl print` to check; leave the release PR unmerged. If stage 0.8 fell back to `require`, do stage 7.1 now. Before the next attempt `stoktok` must be empty: use `--force --confirm stoktok` (no post-cutover data exists yet at this stage). | Nothing. |
| Move failed | As Freeze, including stage 7.1 if stage 0.8 fell back to `require`. Supabase is untouched (read-only). | Nothing. |
| Release, `migrate` failed | `deploy`, `publish` and `rollback` are skipped, so deployment `main` still pins vX.Y.Z and a later `deploy-stoktok` run (any `apps/stoktok/` merge or `workflow_dispatch`) would put production on the stale Postgres copy. First revert the release PR's merge commit in a deployment PR and merge it: that redeploys v0.2.1 (no migrate service) and runs `agent`, which restarts web and the scheduler. The revert run's PR comment must read `deployed: ... v0.2.1 ... is running and healthy.` (suffixes: ` Scheduler NOT installed: see the run.` means v0.2.1 is up but the scheduler is not: bootstrap the agent by hand as in Freeze and check it with `launchctl print`; this suffix alone is not a reason to freeze again. ` Env dir not excluded from Time Machine.` is harmless. Any other text before or instead of `deployed:` means freeze again); on `restored` or `restore-unpushed` (vX.Y.Z is back) or anything else, freeze again (stage 2.3-2.6), stop and report; do not use the site. Only if that run ends without starting any web (e.g. `did-not-complete`): first check that `docker ps --filter label=com.docker.compose.project=stoktok` prints no container and that `docker inspect -f '{{.Config.Image}}' $(docker compose -p stoktok ps -a -q stoktok-web)` names `...stoktok-web:v0.2.1@sha256:...`; if either check fails, freeze again (stage 2.3-2.6), stop and report. Otherwise start it and bootstrap the agent by hand as in Freeze. Then report the failure. | Nothing. |
| Release, web unhealthy | The workflow restores v0.2.1 (`SUPABASE_*` are still in the env file) and reinstalls the agent. If the result is `restore-unpushed`, revert the release PR's merge commit in a deployment PR and merge it. The revert run's PR comment must read `deployed: ... v0.2.1 ... is running and healthy.` (suffixes as above); on `restored` or `restore-unpushed` (vX.Y.Z is back) or anything else, freeze again (stage 2.3-2.6), stop and report; do not use the site. | Nothing (no writes reached Postgres). |
| Inside the 14 days | Prefer fixing forward with a new release. Only if that is impossible: (1) do the stage 2 freeze first, so no job writes to Postgres during the revert; (2) take a dump now with `docker compose -p postgres -f ~/srv/postgres/compose.yml exec -T pg-backup /backup.sh`, then copy the newest `~/srv/backups/postgres/last/stoktok-[0-9]*.dump` (it must be the one just written) into `~/srv/backups/stoktok-cutover/` with mode 600; (3) then revert the release PR's merge commit in a deployment PR; v0.2.1 comes back on the Supabase data as of the freeze. The revert run's PR comment must read `deployed: ... v0.2.1 ... is running and healthy.` (suffixes as above); on `restored` or `restore-unpushed` (vX.Y.Z is back) or anything else, freeze again (stage 2.3-2.6), stop and report; do not use the site. If a fix-forward release was merged after vX.Y.Z, reverting only the release PR does not bring back v0.2.1: revert every stoktok release PR merged since, newest first, in one deployment PR, or stop and report. A later re-cutover repeats stages 2-4, and uses `--force --confirm stoktok` (which truncates every table) only after the hand re-entry is confirmed. | Everything written after the cutover, re-entered by hand: transactions, settings, Settings AI keys (AI stays off on v0.2.1, the Vault keys are revoked). Market data refetches within 20 trading days. |
| After day +14 | No data-store rollback; restore only from pg-backup dumps (deployment `ops/backup/RESTORE.md`). | Everything since the dump. |

### 9. Day +14 (STK-095)
In this order (STK-095 has the details):
1. Merge the contract PR; it stops writing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
2. Delete `STOKTOK_SUPABASE_URL` and `STOKTOK_SUPABASE_SERVICE_ROLE_KEY` from the environment. The `STOKTOK_AUTHEN_*` keys stay.
3. Delete only the Vault `stoktok_ai_key_%` rows (Ming, Supabase dashboard, per STK-095; not run from this runbook).
4. Keep the Supabase `public` tables as a read-only archive.
5. `rm -rf ~/srv/backups/stoktok-cutover` (move dump, pre-migration copy, verify files, the optional CA file).

From then on a rollback to v0.2.1 is impossible.

## Rotate the Supabase key
1. Create the new key in Supabase. For an `sb_secret_...` key, create it next to the old one. For the legacy JWT `service_role` key, rotating means rotating the JWT secret: the old key dies at once and the anon key and all sessions are invalidated too. That includes web's Authen anon key (`STOKTOK_AUTHEN_SUPABASE_ANON_KEY`) and Ming's login session, so web cannot sign anyone in until the anon key is replaced. Then do steps 2 and 3 right away. Verify which applies in the Supabase dashboard.
2. Update the `STOKTOK_SUPABASE_SERVICE_ROLE_KEY` secret of the `stoktok` environment. If the legacy JWT secret was rotated, also update `STOKTOK_AUTHEN_SUPABASE_ANON_KEY` with the new anon key.
3. Run `deploy-stoktok` with `workflow_dispatch` on `main`. It rewrites the env file and, because the content changed, recreates web.
4. Check that web was recreated: `docker compose -p stoktok ps` shows a new start time.
5. Run `/Users/mingming/stoktok/current/run-job.sh eod-prices --dry-run`. The health check does not test the DB key (a well-formed wrong key still passes `/healthz`); this run does.
6. Only then revoke the old key. The key pasted into chat on 2026-11-01 must be revoked, not only replaced.
7. If the legacy JWT secret was rotated, sign in again at `https://<APP_HOSTNAME>/login` and confirm the dashboard shows (the old session is dead).

## Cut a release (first one is v0.1.0)
1. Migrations run in the deploy (a backup, then `migrate`, before the app is replaced). Every migration must work with the previous image (expand, then contract).
2. Release main as an exact version: `git fetch origin && git push origin origin/main:refs/heads/release/0.2.0` (one branch per version, never commit to it directly). The branch name is the version: `release/X.Y.Z` releases exactly `vX.Y.Z`. It must not exist yet and must be higher than every existing release tag. The workflow pushes the tag; do not tag by hand. Other branch names are rejected.
3. Watch the `release` run. It fails before any PR if the commit is not on main, the commit is already released, the version exists or is not higher than the latest, a secret is missing, or an image check fails. A failed run still consumes its version tag (if it got past the guards); release again with the next version branch.
4. Review the release PR: only `apps/stoktok/release.env`, both digests.
5. Merge it.
6. Read the `deploy-stoktok` comment on the PR.
7. Verify (OrbStack runs per user, so run docker as `mingming`): `docker compose -p stoktok ps` shows web healthy, and `docker compose -p stoktok exec stoktok-web node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>r.text()).then(console.log)"` shows `v0.1.0`.
8. Run `/Users/mingming/stoktok/current/run-job.sh eod-prices --dry-run`. From the cutover release on, the health check pings the database (`/readyz`); this dry run also checks the worker side.
9. **HARD GATE: tunnel token.** `mmlabs-online/deployment/proxy/compose.yml` commits the cloudflared tunnel token in git. Before any public hostname is added, rotate the tunnel token in Cloudflare and move it out of git into a host env file (change made in the deployment repo, not this one). Do not continue until this is done and confirmed.
10. **Cloudflare Access application** (Zero Trust, Access, Applications, Self-hosted): application domain `<APP_HOSTNAME>`; one Allow policy with Include, Emails, Ming's email only; no bypass rules; note the session duration. Check in the dashboard that it is saved and the policy is attached.
11. **Then add the public hostname** (Networks, Tunnels, the mmlabs tunnel, Public hostname): `<APP_HOSTNAME>` to service `http://stoktok-web:3000`. Turn on the hostname's Access JWT check ("Protect with Access") and select the application from step 10.
    **Do not reorder steps 9, 10 and 11.** Access is the outer layer; stoktok's `/login` is the inner one.
12. Verify: in a private window `https://<APP_HOSTNAME>/` shows the Access login, not the app. After logging in with Ming's email, stoktok's `/login` shows; signing in with Ming's stoktok account (Restore auth, step 1) shows the dashboard, and "Đăng xuất" returns to `/login`. Submit one form (server actions check Origin/Host); if it fails, record a follow-up. `curl -sI https://<APP_HOSTNAME>/healthz` without a session gets the Access redirect (302/403), not 200.
13. To take it offline again: delete the public hostname first, then the Access application if wanted. Never the reverse.

## Roll back
- During the 14-day window after the Postgres cutover, follow "Cutover runbook (STK-096)", stage 8: data written after the cutover is lost on v0.2.1 and re-entered by hand.
- Automatic: if the new web image is not healthy within 120 s, `deploy-stoktok` restores the previous `apps/stoktok/`, redeploys it, republishes the scheduler directory and pushes the revert to deployment `main`. The run stays red.
- Manual: revert the release PR's merge commit on deployment `main`. That re-triggers `deploy-stoktok`. `workflow_dispatch` from `main` only (other branches are skipped) redeploys what main pins and rewrites the env file.
- **Migrations are not undone, and a restore never migrates.** Roll back across a migration only when the old code works with the new schema. After a revert, the deploy run shows the warning "Database is ahead of this image: nothing was migrated" and the PR comment gets the same suffix; that is expected and does not block the deploy.

## Logs
```
docker compose -p stoktok logs -f stoktok-web
tail -f /Users/mingming/stoktok/logs/eod-prices.log     # also financials.log, signals.log, schedule.log, launchd.log
```
`run --rm` discards the container's logs, which is why `run-job.sh` appends to host files.

## Env list
Names only. Values live in the `stoktok` environment secrets of the deployment repo, and `deploy-stoktok` writes the host env file; they are never in this repo (R3). Reserved variables are not passed to containers until a ticket reads them. Optional variables are always written to the env file; an empty value means the feature is off. `derived` variables are written by `deploy-stoktok` from a committed file in the deployment repo (`STOKTOK_DATABASE_URL` from `postgres/secrets/apps/stoktok.password`), not from a secret of the environment. Deploy-only variables: `STOKTOK_WEB_IMAGE`, `STOKTOK_WORKER_IMAGE` and `STOKTOK_VERSION`, written by `release.yml` into `release.env` (not secrets).

<!-- env-list:start -->
| Name | Service | Status | Secret |
|---|---|---|---|
| `SUPABASE_URL` | web, worker | required now | n |
| `SUPABASE_SERVICE_ROLE_KEY` | web, worker | required now | y |
| `SUPABASE_ANON_KEY` | none | reserved | y |
| `STOKTOK_DATABASE_URL` | web, worker | derived | y |
| `STOKTOK_AI_KEYS_MASTER_KEY` | web, worker | required now | y |
| `AUTHEN_SUPABASE_URL` | web | required now | n |
| `AUTHEN_SUPABASE_ANON_KEY` | web | required now | y |
| `ANTHROPIC_API_KEY` | web, worker | optional | y |
| `GOOGLE_AI_API_KEY` | web, worker | optional | y |
<!-- env-list:end -->

## Restart safety check
Spec section 7: the worker tolerates restarts. Automated coverage (`pnpm test`): `eod-sync.test.ts` (re-run gives the same rows except `fetched_at`, no new gaps), `financials-sync.test.ts` (same), `medium-signals.test.ts` (two runs identical except `computed_at`).

Manual check on the Mac:
1. Run each job twice (`/Users/mingming/stoktok/current/run-job.sh <job>`); row counts of `prices_daily`, `financials`, `signals`, `data_gaps` must not change on the second run.
2. Start `eod-prices`, `docker kill` the container mid-run, rerun, and confirm the counts match a clean run.
3. Resume is window-based: EOD recomputes the last 20 trading days, financials the last 12 quarters, with idempotent upserts. Outages longer than that need the STK-032 backfill.
4. Overlap: `run-job.sh` takes one shared `mkdir` lock (waits up to 30 min, clears a stale lock), so jobs never run concurrently; a timeout exits 1. launchd never runs one job twice at once, and slots missed during sleep coalesce into one run on wake.

## Exit codes
- 0: ok. Nothing to do.
- 1: fatal error, lock timeout or wrong time zone. Read `/Users/mingming/stoktok/logs/<job>.log`; the next scheduled run retries.
- 2: usage error (bad job name or flag). Fix the caller.
