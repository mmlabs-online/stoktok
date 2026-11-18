# STK-096 security review

## Attempt 1

Security review of STK-096, attempt 1. I read the files only and changed nothing. I also read the live `deploy-stoktok.yml` in `/home/user/deployment` to check how the rollback rows behave.

**Verdict:** one 🔴 in the runbook's rollback wording. It is a docs-only fix. The script changes (F4 digest pin, F7 cert, `cleanup()`) are sound. No secret values appear in the changed files.

### Findings

🔴 **S1. After "Release, `migrate` failed", main still pins vX.Y.Z, so production can later end up writing to two databases.** `docs/deploy.md:219`
- Per `/home/user/deployment/.github/workflows/deploy-stoktok.yml:270-315`, a failed migrate skips `deploy`, `publish` and `rollback`. Nothing is restored or reverted, so deployment `main` and the runner's app dir still pin vX.Y.Z.
- The runbook row then says: start web (v0.2.1, on Supabase), bootstrap the agent, "Do not merge again".
- The next `deploy-stoktok` run (any `apps/stoktok/` merge, or a `workflow_dispatch` for a key rotation) would migrate and deploy vX.Y.Z against Postgres. Postgres holds the freeze-time copy, while v0.2.1 has kept writing to Supabase since. Production would silently switch to stale data, and the writes would be split across the two databases.
- The workflow's own message, "the old release is still running" (`deploy-stoktok.yml:283`), is also wrong during a freeze, because web is stopped. Ming could take it at face value.
- **Fix:**
  - In that row, first revert the release PR's merge commit in a deployment PR and merge it. That redeploys v0.2.1 with no migrate service, which also restarts web and the agent.
  - Only then (or instead) do start/bootstrap by hand.
  - Add one line to stage 4: "ignore 'the old release is still running' during the freeze; web is stopped".
- Rule: AC 1 ("rollback per stage" must be correct); R3/R10 do not apply.

🟡 **S2. A re-cutover inside the 14 days wipes Postgres-only data before it is safe elsewhere.** `docs/deploy.md:221`, and `:217` for the same `--force` advice
- "A later re-cutover repeats stages 2-4 with `--force --confirm stoktok`" truncates every table in `stoktok`. That includes the post-cutover rows that the same row says must be re-entered by hand on v0.2.1.
- If any of them have not been re-entered yet, the only copy left is a nightly `pg-backup` dump in 24 h/daily retention.
- **Fix:**
  - Before reverting, freeze (bootout and stop web) and copy the newest `~/srv/backups/postgres/{last,daily}/stoktok-*.dump` into `~/srv/backups/stoktok-cutover/` (mode 600).
  - Do not use `--force` until the re-entry is confirmed done.
  - Note also that the revert itself is not frozen: a job running at revert time can still write to Postgres. Say "freeze first, then revert".

🟡 **S3. The F7 fallback silently downgrades to `require` on a certificate failure.** `docs/deploy.md:148`
- A failed `verify-full`/`verify-ca` is exactly what a man-in-the-middle looks like. The runbook then says unset both and continue with `require`, which sends the Supabase DB password to a server that has not been authenticated.
- STK-091 accepted `require`, so this is not a regression. But "note it" is weak.
- **Fix:** before falling back, re-download the cert from the dashboard and re-check `MOVE_SRC_HOST` against the dashboard's pooler string. If you fall back, treat the password as exposed, which stage 7.1's rotation already covers, and say so in that line.

🟡 **S4. Stage 9.3 is a Supabase write inside the runbook text.** `docs/deploy.md:228`, `work/ming-todo.md:50`
- "Delete only the Vault `stoktok_ai_key_%` rows" conflicts on its face with AC 2 ("Nothing in it … writes into the Supabase project"). The plan treats it as Ming's dashboard step under STK-095.
- **Fix:** label it explicitly, e.g. "(Ming, Supabase dashboard, per STK-095; not run from this runbook)", the way 7.1 is clearly a dashboard step.
- Every other Supabase contact in the section is the script itself (`src_dump`/`src_ro`, read-only transaction with `default_transaction_read_only = on`) or a dashboard action (7.1).
- The `--worker-image` migrate leg only receives `MOVE_DST_*` (`scripts/db-migrate-from-supabase.sh:243-244`).
- `pgro` and the create/drop of `stoktok_scratch` only touch the shared Postgres.

🟡 **S5. Low: "Release, web unhealthy: Nothing lost (no writes reached Postgres)" is not guaranteed.** `docs/deploy.md:220`
- During the up-to-120 s `--wait`, the new web container is already on the tunnel. If `/readyz` fails for a reason other than the DB, a write made in that window lands in Postgres and is lost after the restore.
- **Fix:** add "do not use the site until the deploy comment arrives" to stage 4.1.

🟡 **S6. Low, follow-up (R7): `--worker-image` is not digest-enforced, but it receives the target DB password.** `scripts/db-migrate-from-supabase.sh:59,243`
- F4 pins only `PG_CLIENT_IMAGE`. The worker image gets `STOKTOK_DATABASE_URL` with the `stoktok` role password in its environment. The runbook takes it from the digest-pinned `release.env` (`docs/deploy.md:141`), but the script accepts a tag.
- Suggest a follow-up that applies the same `@sha256:` rule to `IMAGE` when it is not a local run. Not for this diff.

### Checks that passed

- **Secrets in docs and to-do:** none.
  - A grep for `sb_secret_`, JWTs, `sha256:<64 hex>`, URLs with credentials and `MOVE_SRC_PGPASSWORD=` has no hits in `docs/deploy.md` or `work/ming-todo.md`. The only hits repo-wide are test or smoke placeholders in `scripts/`.
  - Placeholders only (`<ref>`, `<region>`, `<digest>`, `vX.Y.Z`, `<APP_HOSTNAME>`).
  - "Never print the env file" and "`docker inspect` only with `-f`" are stated at `:129`. Stage 0.6 obeys the `-f` rule.
- **Password handling:**
  - Stage 0.7 says to export only `MOVE_SRC_HOST` and `MOVE_SRC_USER`. The script prompts on `/dev/tty` with `read -rs` (`script:126-133`), and the prompt shows user@host only.
  - pgpass leftovers are covered at stage 1.7 and 7.2. Shell history is covered at 7.3, and exiting tmux at 7.3 also drops an exported variable.
  - The rotation at 7.1 comes after success and correctly states that it does not affect the API keys or Auth.
- **F4 digest pin** (`script:102-105`):
  - Enforced for every host except the exact strings `localhost`/`127.0.0.1`. Case variants such as `LOCALHOST` count as remote, which is stricter.
  - `repo:tag@sha256:…` is accepted, and Docker then resolves by digest, so that is fine.
  - The check runs before the password read and before any docker call.
  - Stage 0.6 correctly ties the digest to the image the shared Postgres runs (container `.Image` == the tag's local `.Id`).
- **F7 cert** (`script:106-114`, `183-192`, `197-210`, `229`, `366`):
  - The regex `^/[A-Za-z0-9._/-]+$` excludes `:`, `,`, spaces and quotes, so nothing can inject into `-v` or add mount options. `..` and symlinks only choose which host file is mounted; that is operator input, read-only, and must carry a PEM header.
  - The cert is mounted only by `src_dump`/`src_ro`. Every target leg and the `none` leg reset `PG_CERT_CUR=""`.
  - Cert contents are never printed. Under `verify-*`, the TLS check fails before the password is sent.
  - `t_sslrootcert` asserts that the mount appears only on source-role argv lines.
- **`cleanup()` change** (`script:141-151`):
  - Every `usage_err` call comes before `trap cleanup EXIT` (last at `:134`, trap at `:152`), so exit 2 still means "nothing was contacted" (`docs:123`).
  - A tool returning 2 after the trap now correctly reports `FAILED at step:` and exits 1.
  - The secrets dir is removed on every path, including INT/TERM/HUP, and the dry-run dump deletion is unchanged.
  - Side note, already true before this change: `fail()` at `:117-121`/`:136` runs before the trap and exits 1 without "FAILED at step". Harmless.
- **Freeze order** (stage 2): scheduler bootout, then the lock and running-container check, then web stopped. The script's own freeze check blocks a real run (`:157-166`). Stage 2.6 forbids deployment merges and restarts. Source writes during the move would show up as a verify mismatch.

### Risks / minor notes

- After an interrupted real move, a partial `stoktok-supabase-*.dump` stays in the work dir: a real run never deletes its dump. The "Move failed" row could say to delete it; stage 9.5 removes it later anyway.
- Stage 4.2, `ls -t … | head -n 1`: check that the copied dump's timestamp is today. If the backup step did not run, an older dump would be copied without any warning.
- `t_client_image_pin` skips silently when `postgres:17` has no repo digest. It only proves the pass path in CI, where the image is pulled.

### Open questions

- S1: should the "migrate failed" row tell Ming to revert the release PR first, or does Ming prefer to leave main pinned and fix forward? Leaving it pinned is the split-database risk described in S1.

## Attempt 2

Security review of STK-096, attempt 2. I only read files and changed nothing. I read `docs/deploy.md` stages 0-9 (lines 128-232), impl-log Attempt 2 and the live `/home/user/deployment/.github/workflows/deploy-stoktok.yml`.

**Verdict:** S1-S5 are closed and there is no 🔴. Two new 🟡 items are below; both are one-line doc fixes in the same section. S6 is deferred to STK-094, which I accept. A grep of `docs/deploy.md` for secret patterns (`sb_secret_`+chars, JWT prefix, 64-hex digests, URLs with credentials) has no hits.

### Status of the attempt-1 findings
- **S1, closed.** `docs/deploy.md:219` now reverts the release PR first, and `:181` says to ignore "the old release is still running". I traced the revert run against the workflow:
  - The revert restores v0.2.1's `release.env` and compose, so the compose has no `migrate` service. `pull` sets `migrate=false` (`deploy-stoktok.yml:252-257`), so `backup` and `migrate` are skipped.
  - `deploy` runs `up -d --wait` (`:300`), which starts the stopped v0.2.1 web. `publish` (`:302-311`) puts v0.2.1's job files in `SCHED_DIR`. Only after that does `agent` (`:359-404`) find the label not loaded and bootstrap it.
  - So the scheduler restarts only after its directory holds v0.2.1 files, and it writes to Supabase. Nothing writes to Postgres at any point in this path, so there is no race with the scheduler and no second writer.
- **S2, closed.** `:221` now says: freeze first, then copy a dump, then revert, and use `--force` only after the hand re-entry is confirmed. The Freeze row's `--force` advice (`:217`) is limited to "no post-cutover data exists yet". The revert run itself cannot write to Postgres (same trace as S1).
- **S3, closed.** `:148` now says to re-download the cert, re-check `MOVE_SRC_HOST`, and treat the password as exposed if falling back. One gap is noted in N2 below.
- **S4, closed.** `:228` is labelled as Ming's dashboard step. `work/ming-todo.md:50` is Ming's own checklist, so it needs no change.
- **S5, closed.** `:181` now says not to use the site until the deploy comment arrives, which covers the `--wait` window.

### New findings
🟡 **N1. Every revert path (`:219`, `:220` manual revert, `:221`) can put vX.Y.Z back on Postgres instead of v0.2.1, and the runbook never says to check which release ended up running.** `docs/deploy.md:219`, `:221`; mechanism at `deploy-stoktok.yml:123-128` and `:313-356`.
- In the revert run, `BEFORE` is the release merge commit, so `previous` is the vX.Y.Z web image.
- If v0.2.1 fails its 120 s health check, `rollback` restores `apps/stoktok/` from that commit and starts vX.Y.Z. It does not run `migrate`, and the compose now points at Postgres again. It republishes the vX.Y.Z scheduler, installs the agent, and pushes "Restore stoktok vX.Y.Z" to main (or ends as `restore-unpushed`).
- The `:219` row then only says "Only if that run does not start web …". Here web did start, but on the release Ming meant to back out of.
- In the 14-day case this means two writers over time: Ming re-enters data into v0.2.1/Supabase while the scheduler, and anyone using the site, write to Postgres on vX.Y.Z.
- This is unlikely, since v0.2.1 was healthy before.
- **Fix (one sentence in `:219` and `:221`):** "The revert run's PR comment must read `deployed: …v0.2.1… healthy`. On `restored` / `restore-unpushed` naming vX.Y.Z, or anything else, freeze again (stage 2.3-2.5) and stop."

🟡 **N2. The S3 fallback says "the rotation in stage 7.1 covers it", but 7.1 runs only after a *successful* cutover.** `docs/deploy.md:148`, `:209`
- The fallback is decided at the dry run, which can be days earlier. If the cutover is then aborted or rolled back (Freeze, Move failed, or Release rows), a password sent under plain `require` is never rotated.
- **Fix:** in `:148`, say "rotate it (stage 7.1) after the last script run, whatever the outcome". Alternatively, add "do 7.1 if stage 0.8 fell back" to the Freeze and Move failed rows.

### Minor (not security-blocking)
- `:221`, step (2): the newest `last/` dump can be up to about 24 h old. It is a safety net, because Postgres itself is not wiped until `--force`. Still, making "take one with `pg-backup /backup.sh` after the freeze" mandatory, not optional, would make the copy complete.
- `:221`: if a fix-forward release was merged after vX.Y.Z, "revert the release PR's merge commit" no longer gets back to v0.2.1. The PR would need `release.env` and `compose.yml` set back to the v0.2.1 state. The same N1 check covers this.
- `:220`, web unhealthy: a later re-attempt needs `--force` because `stoktok` is non-empty. That is safe only because S5 says the site was not used. A pointer to the Freeze row's `--force` note would make it explicit.

### Risks
- The N1 failure mode is silent apart from the PR comment and a red run. The data split it causes is the same harm as attempt-1 S1, though reached by a much less likely route.

### Open questions
- None. N1 and N2 are wording fixes inside `docs/deploy.md` stage 0.8 and stage 8, within the ticket's scope.

## Attempt 3

Security review of STK-096, attempt 3. I only read files and changed nothing. I read `docs/deploy.md` lines 120-239, impl-log "Attempt 3", and the live `/home/user/deployment/.github/workflows/deploy-stoktok.yml` (release/previous at :123-133, pull/backup/migrate/deploy/publish at :245-311, rollback at :313-356, notify at :406-457).

**Verdict:** N1 and N2 are closed. There is no 🔴. I found two new low 🟡 items. Both are wording only, neither blocks, and either can go to follow-ups. I grepped `docs/deploy.md` for secret patterns (`sb_secret_`+chars, JWT prefix, 64-hex digests, URLs with credentials, `PGPASSWORD=`+value) and found nothing. No secret values appear in this report.

### Status of the attempt-2 findings
- **N1, closed.** `docs/deploy.md:219`, `:220` and `:221` now all say that the revert run's PR comment must read `deployed: ... v0.2.1 ... is running and healthy.`, and that on `restored` / `restore-unpushed` or anything else, Ming freezes again, stops and reports.
  - The quoted text matches notify `success:` at `deploy-stoktok.yml:439`.
  - On a revert run, `$IMAGE` is v0.2.1 and `$PREVIOUS` is vX.Y.Z (`:123-128`, BEFORE = the release merge commit). So the doc's "(vX.Y.Z is back)" correctly reads the `restored` (`:440`) and `restore-unpushed` (`:441`) messages.
  - Notify comments on the PR of `GITHUB_SHA` (`:454-456`), which is the revert PR's merge commit. The comment lands where the runbook tells Ming to look.
  - The freeze comes after the `agent` step has reinstalled the vX.Y.Z scheduler (`:361`). The comment is posted only after that, so freezing on the comment does stop that scheduler.
- **N2, closed.** `docs/deploy.md:148` now says to rotate as in stage 7.1 "after the last script run, whatever the outcome (also after an aborted cutover or a rollback)". The Freeze row (`:217`) and the Move failed row (`:218`) point to 7.1 explicitly. The Release and 14-day rows rely on the general statement in 0.8, which covers them.

### New findings
🟡 **N3 (low). After a `restored` revert run, main pins vX.Y.Z again, but the re-freeze only cites stage 2.3-2.5. That leaves out 2.6, "no deployment-repo merge".** `docs/deploy.md:219`, `:220`, `:221`; mechanism at `deploy-stoktok.yml:348-354` (the bot pushes "Restore stoktok vX.Y.Z" to main).
- In that state, the next `apps/stoktok/` merge or `workflow_dispatch` puts vX.Y.Z on Postgres while Ming is re-entering data on Supabase. That is the attempt-1 S1 split-writer hazard, reached by an unlikely route.
- "Stop and report" implies no merges, but the runbook already has a rule for this: stage 2.6, which also forbids reboots and OrbStack restarts.
- **Fix:** change "stage 2.3-2.5" to "stage 2.3-2.6" in all three rows.

🟡 **N4 (low). In the `migrate` failed row, "freeze… stop" and "start by hand" contradict each other.** `docs/deploy.md:219`
- The row says to freeze and stop on "anything else", and then "Only if that run ends without starting any web (e.g. `did-not-complete`), start it … by hand". But `did-not-complete` is one of the "anything else" results.
- `did-not-complete` (`:444`) also covers a run cancelled or timed out (`timeout-minutes: 15`) inside `rollback`, after `git restore` and `up -d` of vX.Y.Z (`:331-333`). A vX.Y.Z web may then be running or starting on Postgres.
- **Fix:** before starting web by hand, check that `docker ps --filter label=com.docker.compose.project=stoktok` lists no container and that `docker inspect -f '{{.Config.Image}}' stoktok-web` names v0.2.1. Otherwise, freeze and stop.
- Low risk: in the usual migrate-failed case, `deploy` never ran, so the stopped container is still v0.2.1.

### Minor (not security)
- If the `agent` step fails, notify adds a suffix to the success message: "Scheduler NOT installed: see the run." (`:447`). In that case the text no longer strictly matches "must read …". Stage 4.1 already calls out that suffix; the revert-row text could do the same. Either reading is safe, because the release is v0.2.1 on Supabase.
- The attempt-2 minor notes (make the 14-day dump mandatory; a fix-forward release merged after vX.Y.Z) are unchanged. N1's check catches the second one.

### Risks
- N3 and N4 are both small wording gaps that could lead back to the split-database harm (S1). Each needs an unlikely run result first: v0.2.1 failing its health check, or a run cancelled in the middle of a rollback.

### Open questions
- None. Given that attempt 3 is the last allowed rework, the orchestrator can send N3 and N4 to follow-ups (for example STK-094's notes), or fix them as wording-only edits to `docs/deploy.md`.

Files: /home/user/stoktok/docs/deploy.md, /home/user/stoktok/work/tickets/STK-096/impl-log.md, /home/user/stoktok/work/tickets/STK-096/security-review.md, /home/user/deployment/.github/workflows/deploy-stoktok.yml
