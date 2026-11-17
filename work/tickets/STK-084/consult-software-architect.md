## Consult: software-architect on STK-084 (cutover to the shared Postgres)

Read-only consult. Line numbers refer to the files as they are today (deployment repo at main).

### Findings

**F1. The "drop the Supabase DB secrets" step in the ticket's deployment PR would break production twice.**
- The running release v0.2.1 (`deployment/apps/stoktok/release.env:2-4`) reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
- Any merge that touches `apps/stoktok/**` redeploys it (`deploy-stoktok.yml:27`), and the env file is rewritten on every run (`:155-208`).
- If that PR drops the secrets, v0.2.1 loses its database the moment the PR merges.
- Later, any automatic restore (`:252-254`) or manual revert to v0.2.1 would also start without a database.
- Fix: the env file must carry both the Supabase values and the Postgres values (expand) until the rollback window closes, then drop the Supabase ones (contract).

**F2. The worker would lose internet access if it joins only `db`.**
- `db` is `--internal` (`postgres/compose.yml:115-117`), so it has no egress.
- Today the worker has no `networks:` key (`apps/stoktok/compose.yml:45-52`), which puts it on the project default network, and that is how it reaches TCBS/VCI/RSS.
- `networks: [db]` alone would drop the default network. It must be `networks: [default, db]`.
- Web needs `[tunnel, db]`, as TuDo does (`apps/tudocuatui/compose.yml:75`).
- `migrate` should be on `[db]` only (`tudocuatui/compose.yml:86`).

**F3. A `migrate` service merged while v0.2.1 is pinned turns the deploy red.**
- TuDo runs migrate whenever the service exists (`deploy-tudocuatui.yml:161-166`).
- The v0.2.1 worker has no `migrate` subcommand (it came with STK-089), so it exits 2 with a usage error.
- TuDo's precedent is to add the compose change in the first release PR (`tudocuatui/compose.yml:8`, M-14). `pr-scope.yml:28-37` allows `apps/stoktok/**` in a release PR. `release.yml:149-151` only constrains the bot's own commit.

**F4. Switching the health check to `/readyz` early has the same trap.**
- v0.2.1 has no `/readyz`, so it would 404, go unhealthy and trigger a rollback.
- Today's `/healthz` never touches the database (`apps/web/app/healthz/route.ts:2`). A wrong `STOKTOK_DATABASE_URL`, or web not being on `db`, would still deploy "healthy" (the same blind spot `docs/deploy.md:97,109` already notes).
- Adding `/readyz` also means adding it to `PUBLIC_PATHS` (`apps/web/proxy.ts:7`) and the CLAUDE.md R6 note.

**F5. `check-deploy-env.sh` cannot pass with the target workflow as written.**
- It requires the single env-file `printf` to begin with `SUPABASE_URL=` (`:103,125,128,169,177`).
- It requires every required or optional key `K` to be mapped from `secrets.STOKTOK_K` (`:146-151`). That fails twice:
  - `STOKTOK_DATABASE_URL` is built from the password file, not from a secret.
  - The master key would be looked up as `secrets.STOKTOK_STOKTOK_AI_KEYS_MASTER_KEY`, but Ming created `STOKTOK_AI_KEYS_MASTER_KEY` (ticket line 41).
- The status set only allows `required now`, `optional` or `reserved` (`:114`).
- The optional-key guard regex `^[A-Za-z0-9._-]*$` (`:166`) does not fit base64.

**F6. The stoktok draft and the live deployment workflow have drifted apart.**
- The draft `stoktok/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml:207` writes `ANTHROPIC_API_KEY` and `GOOGLE_AI_API_KEY`.
- The live `deployment/.github/workflows/deploy-stoktok.yml:196` writes only the 4 Supabase/Authen keys.
- So STK-072's deployment step was never merged. The expand PR will ship it as a side effect, and Ming should know.
- The live comments are also stale: `deploy-stoktok.yml:21-22` ("No migrate step") and `apps/stoktok/compose.yml:14`.

**F7. The release flow and its stale text.**
- How a release is cut: pushing `release/vX.Y.Z` runs `release.yml`, which tags, builds both images and opens `release/stoktok-vX.Y.Z` on the deployment repo changing only `apps/stoktok/release.env` (`release.yml:133-156`). Nothing deploys until Ming merges that PR.
- That means the images exist before the deploy, which the data move needs: the migrate step uses the worker image.
- Stale text to update:
  - The PR body still says "Apply database migrations before merging" (`release.yml:156`).
  - `docs/deploy.md:102` says the same.
  - The env table rows (`docs/deploy.md:138-139`) are still `reserved`.

**F8. The pre-migration backup is already in place.**
- `pg-backup /backup.sh` dumps every database listed in `config/databases` (`postgres/compose.yml:77`, `deploy-tudocuatui.yml:173`).
- `add-app-db.sh stoktok` puts stoktok into the nightly backups at once (`add-app-db.sh:39-44`).
- `deploy-postgres` creates the role and database on merge (`deploy-postgres.yml:127-132`).

**F9. Restore can run inside the shared Postgres container.**
- `ops/backup/RESTORE.md:143` already does `exec -T postgres pg_restore -U postgres --role=$APP -d $APP < dump`.
- That avoids needing a container on both `db` and an egress network. `db` has no egress, so `pg_dump` from Supabase must run in a separate container on a normal network and write to a host file.
- `RESTORE.md:151` (`${APP}_restore`) is a precedent for the scratch database used in the dry run.

**F10. "Database ahead of the image".**
- Both stoktok (`packages/db/src/pg/migrate.ts:173-176`) and TuDo (`server/migrator.js:149-150`) log a warning and exit 0.
- `release.yml:61-64` forbids a version lower than the latest. So "ahead" can only happen through a revert or rollback: the manual revert of a release PR re-triggers the deploy with the old compose and image.

**F11. Where the idle-in-transaction timeout would go.**
- `client.ts:77-80` already sets per-pool session settings with one `set_config` statement, with values coming from `config.ts`.
- `add-app-db.sh:59-60` supports optional per-app SQL in `postgres/sql/apps/<app>.sql`.

### Recommendations

**R1. Split STK-084.** Each step keeps production on v0.2.1 until step D:
- **A. stoktok repo, merged to main, no release:**
  - `/readyz` (DB `select 1`, body only `ok` or 503) and its `PUBLIC_PATHS` entry.
  - `idle_in_transaction_session_timeout` in the `client.ts:78` `set_config` statement, per profile in `config.ts`, with a unit test. Use a generous worker value because chunked upserts run in one transaction (ADR 0010 §14).
  - `scripts/db-migrate-from-supabase.sh`.
  - Updated drafts under `deploy/deployment-repo/` and a rewritten `check-deploy-env.sh` (see R5).
  - `release.yml` PR body.
  - `docs/deploy.md` cutover runbook and env table, CLAUDE.md Stack/DB/Runtime rows, the spec §7 items.
  - Satisfies the AC "nothing changes the running release" and R8.
- **B. Deployment PR 1 (`postgres/` only):** the `add-app-db.sh stoktok` output (`config/databases` plus the password file). This creates an empty database and has no effect on stoktok.
- **C. Deployment PR 2 ("expand", `apps/stoktok/compose.yml` and `deploy-stoktok.yml`):**
  - Networks as in F2.
  - The env file additionally gets `STOKTOK_DATABASE_URL=postgres://stoktok:<pw>@postgres:5432/stoktok` (from the password file, TuDo pattern `deploy-tudocuatui.yml:103-108,142`) and `STOKTOK_AI_KEYS_MASTER_KEY` (required, `^[A-Za-z0-9+/]{43}=$`).
  - The `SUPABASE_*` lines stay.
  - Port TuDo's pull/backup/migrate steps (`:154-186`), guarded on the compose file having a `migrate` service. Do not add the service yet.
  - The compose change in this PR triggers a deploy, which recreates v0.2.1 (env changed) and should stay green.
- **D. Cutover** (Ming's runbook): the release PR, plus one extra commit in that PR adding the `migrate` service and switching the health check to `/readyz` (F3/F4, TuDo M-14 precedent).
- **E. Contract, after the rollback window** (proposed 14 days):
  - A deployment PR stops writing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
  - Then Ming deletes those environment secrets (the same ordering as the STK-060 note in `docs/deploy.md:72-80`), deletes the Vault `stoktok_ai_key_%` rows, and decides what happens to the Supabase `public` tables.
  - Docs mark rollback to v0.2.1 as impossible from here.

**R2. Cutover order:**
1. **Dry run.**
   - Create `stoktok_scratch OWNER stoktok` through a superuser `exec`.
   - Run the release worker image `migrate` against it with a temp env file (no URL on argv).
   - `pg_dump` from Supabase through the session pooler on port 5432. The direct host is likely IPv6-only on the Free tier and OrbStack may not route IPv6.
   - `pg_restore --single-transaction` via `exec` into the postgres container, then `setval`, then counts and md5.
   - Also run the optional live `--schema-only` comparison (STK-083 F1). It is cheap; make it mandatory.
   - Drop the scratch database.
2. **Freeze**, outside the job slots: 18:30 and 21:00 Mon–Fri (`run-schedule.sh:2`), so a weekend or daytime.
   - `launchctl bootout gui/$UID/online.mmlabs.stoktok.jobs`.
   - Confirm `/tmp/stoktok-jobs.lock` is absent.
   - `docker compose -p stoktok stop stoktok-web`. Web writes too (transactions, settings, `ai_reserve`, and on-demand intraday prices per ADR 0006), so any write after the dump would be lost.
3. **Move the data:** run the script against `stoktok`. It refuses a non-empty target, migrates the schema (baseline), then dump → restore → `setval` ×6 → verify.
4. **Merge the release PR.** The deploy runs backup → migrate ("up to date") → `up -d` → `/readyz`.
   - The agent step reinstalls the LaunchAgent because it is not loaded (`deploy-stoktok.yml:295-320`), which ends the freeze.
5. **Verify:**
   - `/healthz` shows the new version.
   - Log in, compare dashboard totals with Supabase.
   - `run-job.sh eod-prices --dry-run`.
6. **AI keys:**
   - Issue new keys at Anthropic and Google and enter them on Settings.
   - Revoke the old keys.
   - Grep the web logs and `~/stoktok/logs/*.log` for `ai_keyring_invalid`; there should be none.
7. **Day +14:** step E.

**R3. Rollback per stage:**
- **Before step 4:** run `docker compose -p stoktok start stoktok-web` and re-bootstrap the agent. Production never changed. Empty the stoktok database before retrying (the script refuses a non-empty target).
- **Step 4 unhealthy:** the automatic restore brings back the C compose plus v0.2.1. The env file still has `SUPABASE_*`, so it works on Supabase data. The rollback path also reinstalls the agent (`:282`).
- **Problem found inside the window:**
  - Revert the release-PR merge. v0.2.1 comes back on Supabase.
  - Market data is refetchable (20-trading-day window).
  - User entries made since the cutover must be re-entered, unless a reverse move is scripted.
  - AI on v0.2.1 is unavailable because the Vault holds the revoked keys. That degrades AI but locks nobody out.
  - Prefer fixing forward.
- **After step E:** no data-store rollback. Restore from `pg-backup` dumps (`RESTORE.md`).

**R4. Database ahead of the image:** do not block. Keep exit 0, as TuDo does, so a manual revert stays one click during an incident (F10).
- Make it visible: the migrate step captures the output (it never prints the URL, `migrate.ts:2-3`), emits `::warning::`, and the notify message gets a suffix.
- Pin the `warning: database is ahead` prefix with a stoktok unit test so the workflow's grep stays stable.

**R5. Rewrite `check-deploy-env.sh` around the new shape:**
- A `derived` status for `STOKTOK_DATABASE_URL`, checked against the `pwfile` read.
- An env-to-secret name map in which already-prefixed `STOKTOK_*` names map to themselves.
- A per-key format guard (base64 for the master key).
- The `printf` anchored on its first key, not on `SUPABASE_URL`.
- During the expand phase, `SUPABASE_*` stays `required now`. Flip it in E.

**R6. Idle timeout: set it in `client.ts`, not as a role setting.** It is versioned with the code, testable by `test:db`, can differ per profile, and does not affect `migrate` or manual psql. The role-level `postgres/sql/apps/stoktok.sql` remains a fallback.

**R7. Data move details:**
- Pass the Supabase password through a mode-600 temp env file, never argv.
- `--exclude-table=public.ai_keys`. Live Supabase never got it (ADR 0011:54).
- No `--inserts`: COPY accepts GENERATED ALWAYS identity columns.
- If foreign-key order breaks the data-only restore, `--disable-triggers` needs the superuser without `--role`. Find out in the dry run.
- Delete or chmod 600 the plaintext dump afterwards.

**R8. Review the release contents first.** The cutover release ships everything merged since v0.2.1, not only STK-081–089. Review `git log v0.2.1..main` before cutting, and freeze unrelated merges, so an unrelated bug does not force a data-store rollback.

### What Ming must do by hand
1. Keep the copy of the master key in the password manager. The environment secret already exists.
2. Merge deployment PR B. Check `deploy-postgres` is green.
3. Merge deployment PR C. Check the deploy is green and v0.2.1 is healthy, then run `run-job.sh eod-prices --dry-run`.
4. Merge stoktok A. Push `release/v0.3.0` (or whatever version is chosen).
5. Approve the extra compose commit on the release PR. Do not merge yet.
6. Get the Supabase database password (reset it if unknown; that does not affect the API keys) and the session-pooler host.
7. Do the dry run, then the cutover steps 2–6 (R2).
8. Issue, enter and revoke the AI keys, and check the logs.
9. On day +14: merge the contract PR, delete `STOKTOK_SUPABASE_URL` and `STOKTOK_SUPABASE_SERVICE_ROLE_KEY`, and delete the now-unused secret key in Supabase. Delete the Vault rows. Decide on the Supabase tables.

### Risks
- **Supabase Free pausing becomes more likely.** After the cutover only logins touch Supabase, so after a quiet week `/login` can be down (ADR 0010 §11). Add this to the spec risks row.
- **Plaintext data off the database.** The dump file on the host and the Supabase password in a temp file both hold sensitive data.
- **Freeze discipline.** Missing the freeze (web or jobs still writing to Supabase after the dump) silently loses data.
- **Partial health check.** Until `/readyz` is in the release PR, the health check does not prove the database path. If the hand edit is forgotten, `/healthz` still passes with a bad URL.
- **The shared env file widens what each container can read.** The `migrate` container and the worker can read the Authen key, the AI master key and, during the window, the Supabase service-role key. TuDo accepts this (`tudocuatui/compose.yml:22-23`).
- **The scheduler covers only 3 jobs.** `run-schedule.sh` runs eod-prices, financials and signals; news, financial-statements and resolve-holiday-gaps are not scheduled. This is a follow-up (R7 rule), not this ticket.
- **One stale CLAUDE.md line outside the rows the ticket names.** "Current state: repository scaffold only" (CLAUDE.md:26) is stale.

### Open questions
1. **How long is the rollback window?** 14 days as proposed? And should user writes made during the window be reverse-movable (a script), or does Ming accept re-entering them?
2. **Release-PR edit or a version-agnostic health check?** R1-D adds the migrate service and the `/readyz` health check in a commit on the release PR. Is that acceptable, or should C use a health check that falls back to `/healthz` when `/readyz` returns 404?
3. **STK-090 is missing from Depends on.** ADR 0010:25 lists STK-090 before STK-084, but the ticket does not depend on it. Is that intentional?
4. **What happens to the Supabase `public` tables after step E?** Truncate, drop, or keep them as a frozen archive?
5. **The Settings data lock in the ticket.** Should the cutover window also announce (or enforce) a read-only state, or is stopping web enough?

Files: /home/user/stoktok/work/tickets/STK-084/ticket.md, /home/user/deployment/.github/workflows/deploy-stoktok.yml, /home/user/deployment/.github/workflows/deploy-tudocuatui.yml, /home/user/deployment/apps/stoktok/compose.yml, /home/user/deployment/apps/tudocuatui/compose.yml, /home/user/deployment/postgres/compose.yml, /home/user/deployment/postgres/scripts/add-app-db.sh, /home/user/deployment/.github/workflows/pr-scope.yml, /home/user/deployment/ops/backup/RESTORE.md, /home/user/stoktok/.github/workflows/release.yml, /home/user/stoktok/scripts/check-deploy-env.sh, /home/user/stoktok/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml, /home/user/stoktok/packages/db/src/pg/client.ts, /home/user/stoktok/packages/db/src/pg/migrate.ts, /home/user/stoktok/apps/web/proxy.ts, /home/user/stoktok/docs/deploy.md, /home/user/stoktok/docs/adr/0010-self-hosted-postgres-data-layer.md, /home/user/stoktok/docs/adr/0011-ai-provider-keys-app-side-encryption.md
