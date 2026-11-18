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
