Status: READY

# Plan — STK-094: Cutover to the shared Postgres (STK-084 slice D)

This plan covers the **stoktok-repo slice** that the loop implements and reviews:
- the drafts in their cutover state;
- `check-deploy-env.sh` pinning that state;
- the runbook fixes carried over from STK-096;
- S6;
- ADR 0003;
- the release review.

The rest of the ticket consists of outward actions that are **not** done by the implementer or reviewer:
- cutting the release;
- adding the compose commit to the deployment release PR;
- merging;
- the runbook;
- the AI keys.

Those are sequenced in `## Release and cutover sequence (outward actions)` below. The loop ends with a PR into stoktok `main`. The cutover happens after Ming merges that PR.

## Spec summary
- ticket.md Goal: "drafts updated to the cutover state; the release-PR commit adds the `migrate` service and switches the health check to `/readyz`; Ming runs the runbook; new AI provider keys entered on Settings, old ones revoked; confirm `ai_keyring_invalid` never appears in logs."
- ticket.md AC: "Nothing applies a migration to the Supabase project; no secret is committed." "Repo checks green (stoktok: typecheck, lint, test, test:db, db:check; deployment: its CI)."
- STK-084 plan, split row D: "Update the drafts to the cutover state (`migrate` service on the worker image, `command: ["migrate"]`, `networks: [db]`, profile `migrate`; web health check `/readyz` with `AbortSignal.timeout(3000)`), review `git log v0.2.1..main`, cut the release, add the compose commit to the release PR; Ming runs the STK-091 runbook; new Anthropic/Google keys on Settings, revoke old ones, confirm no `ai_keyring_invalid`; ADR 0003 health line".
- STK-084 plan D2: "the cutover release-PR commit (D) switches it to `/readyz` together with adding the `migrate` service."
- ticket.md notes 2026-11-18 (carried from STK-096):
  - S6: "consider requiring `@sha256:` for `--worker-image` on non-local runs of `scripts/db-migrate-from-supabase.sh`". Also the review nits from Attempt 1 that STK-096 did not fix.
  - N3: rollback rows re-freeze per stage 2.3–2.6.
  - N4: before starting web by hand after `did-not-complete`, check that no stoktok container runs and that the web image is v0.2.1.
  - The "Scheduler NOT installed" notify suffix breaks the exact "must read" match; the runbook should say so.
  - ming-todo item 7 wording.
  - The fresh pg-backup dump becomes mandatory in the 14-day row.
  - Stage 4.2 dump glob.
  - "Update the CLAUDE.md 'Current state' line after the cutover."
- ticket.md note 2026-11-18: "the release review is part of this ticket. Cutting the release (pushing `release/vX.Y.Z`) and merging the release PR are outward actions: the orchestrator asks Ming before cutting, and Ming merges."
- CLAUDE.md R3 (no credential in a committed file, argv or log), R7, R8, R10 (no brokerage).

## Decisions taken in this plan
| # | Question | Decision | Why |
|---|---|---|---|
| P1 | When does the CLAUDE.md "Current state" line change? | **After the cutover, not in this diff.** Until runbook stage 4 succeeds, production stays on Supabase, so the current line ("Production still runs the Supabase-backed release until the shared-Postgres cutover") stays true. After stage 5 passes, the orchestrator changes it with `/solo` or in STK-095. The text to use is under Follow-ups. | The ticket note says "after the cutover". Writing it now would make CLAUDE.md false for days, and false again if the cutover is rolled back. |
| P2 | Does the deploy workflow draft change? | **No.** `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` stays byte-identical to the live file. That file already runs `pull → backup → migrate → deploy` as soon as the compose has a `migrate` service. The stale header phrase "health check (/healthz)" (draft line 5) goes to follow-ups (STK-097). | A release PR may change only `apps/stoktok/` (`deployment/.github/workflows/pr-scope.yml:28-37`). A workflow change would need a separate setup PR, which the cutover does not need. |
| P3 | `migrate` service hardening | `cap_drop: [ALL]` and `security_opt: ["no-new-privileges:true"]` on `migrate` only, as TuDo does (`deployment/apps/tudocuatui/compose.yml:81-82`). Web and worker stay unchanged. | It is a one-shot container that carries the DB credential, and the TuDo precedent shows it works. Web and worker hardening would be a behaviour change outside the plan (R7). |
| P4 | Version | **v0.3.0**, after checks (sequence step B). | Local tags are `v0.1.0 v0.1.1 v0.2.0 v0.2.1` (`.git/refs/tags`). A remote branch `origin/release/v0.2.2` exists (`2a61290`) with no local tag v0.2.2, so a v0.2.2 attempt was made and that version cannot be reused. A data-store change justifies a minor bump in 0.x. `release.yml:58-64` refuses an existing tag or a tag that is not higher. The STK-084 architect consult (§"What Ming must do", 4) names `release/v0.3.0`. |
| P5 | How the compose commit gets onto the release PR | The orchestrator, with Ming's OK given together with the OK to cut, pushes a second commit to the deployment branch `release/stoktok-v0.3.0`. That commit makes `apps/stoktok/compose.yml` equal to `git show v0.3.0:deploy/deployment-repo/apps/stoktok/compose.yml`, byte for byte. | Same as the TuDo M-14 precedent (`tudocuatui/compose.yml:8`). `pr-scope` allows any change under `apps/stoktok/`. `release.yml:149-151` constrains only the bot's own commit. |
| P6 | Is S6 local-exempt? | Yes. The `--worker-image` digest rule applies only when the source host is remote (`SRC_LOCAL=0`), the same rule as `PG_CLIENT_IMAGE` (script:102-105). | The harness and local tests use a local source. The real runs (runbook stages 1 and 3) are remote, and they use `STOKTOK_WORKER_IMAGE` from `release.env`, which is `repo:tag@sha256:<64>` and passes. |

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Draft compose in its cutover state. Web: health check `fetch('http://127.0.0.1:3000/readyz',{signal:AbortSignal.timeout(3000)})`, no `/healthz` left in the web block, everything else unchanged. Worker unchanged. New `migrate` service: `image: ${STOKTOK_WORKER_IMAGE:?…}`, `restart: "no"`, `profiles: [migrate]`, the same `env_file`, `command: ["migrate"]`, `networks: [db]`, `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`, no ports. The header comment describes the cutover state and the hand command `run --rm migrate`. | Read `deploy/deployment-repo/apps/stoktok/compose.yml`. `docker compose -f … --env-file <scratch release.env with dummy digests> --profile jobs --profile migrate config --quiet` exits 0 if docker is available; otherwise a YAML parse (`node -e` with the `yaml` package if it is in the lockfile, else `python3 -c 'import yaml'`). |
| 2 | `check-deploy-env.sh` pins the cutover state (Approach step 2). The real drafts pass. | `pnpm check:deploy-env` prints OK. Then mutations in a scratch copy of the repo; each must FAIL: (a) web health check back to `/healthz`; (b) `AbortSignal.timeout` removed; (c) `migrate` networks `[default, db]`; (d) `migrate` networks `[tunnel, db]`; (e) `profiles: [migrate]` removed; (f) `migrate` image `${STOKTOK_WEB_IMAGE…}`; (g) `command` removed or `["migrate","--x"]`; (h) `migrate` service deleted; (i) worker networks `[db]` (existing check, must still FAIL with `migrate` placed after the worker); (j) `migrate` without `env_file`. |
| 3 | Draft workflow unchanged; the drafts still mirror the live deployment repo except `compose.yml`. | `git diff --stat origin/main -- deploy/deployment-repo/` lists only `apps/stoktok/compose.yml` and `README.md`. `cmp deploy/deployment-repo/.github/workflows/deploy-stoktok.yml /home/user/deployment/.github/workflows/deploy-stoktok.yml` shows no difference (same for `run-job.sh`, `run-schedule.sh`, the plist). |
| 4 | S6: a remote-source run with a `--worker-image` that is not digest-pinned exits 2 with "--worker-image must be pinned by digest" and makes no docker call. A digest-pinned ref (`repo[:tag]@sha256:<64 hex>`) passes the guard. | `pnpm test:move` (CI): `t_usage_guards` new asserts and `t_client_image_pin` new asserts. Mutation: remove the guard, and `t_usage_guards` FAILs. |
| 5 | STK-096 Attempt 1 N1: the `pg_restore -l` TOC leg runs without the source CA mount (`PG_SSL_CUR="prefer"; PG_CERT_CUR=""` before it). | Read script around the `dump table of contents` step. `t_sslrootcert` stays green. |
| 6 | STK-096 Attempt 1 N2: each cert guard in `t_usage_guards` also asserts its message. | Read the harness. `pnpm test:move` green in CI. |
| 7 | Runbook fixes in `docs/deploy.md` "Cutover runbook (STK-096)", each listed in Approach step 4 (N1–N4 of Attempt 3, Attempt 2 N1/N2, Attempt 1 N4/N6). | Read the diff of `docs/deploy.md`. `grep -n 'stoktok-\*\.dump' docs/deploy.md` returns nothing. `grep -c '2.3-2.6' docs/deploy.md` ≥ 3. Every quoted workflow string still exists in `deploy-stoktok.yml` (`grep -F`). |
| 8 | `docs/deploy.md` Flow, "Shared Postgres (STK-084)" and "Cut a release" describe the cutover release correctly, including the new subsection "Cutover release (STK-094)" (sequence below, in short). | Read. `pnpm check:deploy-env` OK (it reads the doc's env table and the plist label line). |
| 9 | `work/ming-todo.md`: item 7 (stage 7) wording; a new item to approve the v0.3.0 cut and the compose commit; stage 0 mentions that the release PR has 2 changed files. | Read. Stage names and order still match runbook stages 0–7. |
| 10 | ADR 0003: the health line and the network line say what holds from the cutover release on; an amendment paragraph (STK-094) records the `migrate` service and `/readyz`. | Read `docs/adr/0003-deploy-and-scheduling.md`. |
| 11 | `deploy/deployment-repo/README.md` says the cutover `compose.yml` reaches the deployment repo **only** as the second commit of the release PR. It must never go in a setup PR while v0.2.1 is pinned (architect F3/F4). The workflow is not copied. | Read. |
| 12 | Release review recorded in impl-log as the table in `## Release readiness`, from commands run on `origin/main`. Any unexpected finding is marked BLOCKING-FOR-CUT and is not fixed in this diff. | Read impl-log. The reviewer re-runs R-1, R-2 and R-3. |
| 13 | Nothing touches the Supabase project. No secret, no digest of a real image and no password in any file. No `release/*` push, no tag, and no change in `/home/user/deployment` during the loop. | `git diff --stat origin/main...` lists only files from the table below. A grep of the added lines for `sb_secret_`, `eyJ`, `@sha256:[0-9a-f]{64}` (except the 64-zero or 64-`a` test fixtures), `postgres://[^$<]*:[^$<]*@` finds no real value. No new remote refs. |
| 14 | Checks green: `typecheck`, `lint`, `test`, `test:db`, `db:check`, `check:deploy-env`, `check:service-key`, `test:move`, `bash -n scripts/*.sh`. | Run locally where possible; CI (`.github/workflows/ci.yml`) on the final PR head for `test:move` (needs docker). |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `deploy/deployment-repo/apps/stoktok/compose.yml` | Cutover state (AC 1; Approach step 1) | Ticket goal; STK-084 D2, row D |
| `scripts/check-deploy-env.sh` | Pin the cutover compose (AC 2; Approach step 2) | Ticket ("check-deploy-env.sh updated to pin the cutover state") |
| `scripts/db-migrate-from-supabase.sh` | S6 guard after script:105; N1 reset before the TOC `pg_restore -l` (script:358-359); header comment line for S6 | S6, Attempt 1 N1 |
| `scripts/test-db-migrate-from-supabase.sh` | S6 asserts in `t_usage_guards` and `t_client_image_pin`; N2 message asserts | AC 4, 6; R8 |
| `docs/deploy.md` | Runbook fixes (Approach step 4); Flow line; Shared Postgres step 3 and the `/healthz`/`/readyz` paragraph; new subsection "Cutover release (STK-094)"; "Cut a release" step 8; "Data move script" `--worker-image` line | AC 7, 8 |
| `docs/adr/0003-deploy-and-scheduling.md` | Status line, decision lines 11 and 15, amendment | Ticket ("ADR 0003 health line"); line 11 would otherwise contradict the compose |
| `deploy/deployment-repo/README.md` | STK-094 paragraph (AC 11) | Makes the copy rule for the cutover compose explicit |
| `work/ming-todo.md` | Lines 40 and 47, plus one new approval item (AC 9) | ticket note (ming-todo item 7) |
| `work/tickets/STK-094/impl-log.md` | Implementer log, including the release-review table | Workflow; AC 12 |

No other files. In particular, none of these change:
- `.github/workflows/release.yml` (its PR body already describes migrate);
- the draft or live deploy workflow (P2);
- `CLAUDE.md` (P1);
- `apps/**` and `packages/**`;
- `db/migrations/**` and `supabase/**`;
- `.env.example` and the env table (the env names do not change).

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `scripts/test-db-migrate-from-supabase.sh` › `t_usage_guards`: `XENV="MOVE_SRC_HOST=db.example.invalid MOVE_SRC_SSLMODE=require PG_CLIENT_IMAGE=postgres@sha256:<64×0>"`, `run_move --target "$DST_DB" --worker-image mingming21400/stoktok-worker:v0.3.0` → `rc_is 2`, `out_has "--worker-image must be pinned by digest"` | S6 refusal (and, through the existing final assert, "no docker call for any guard") |
| same › `t_usage_guards`: the same remote env with `--worker-image mingming21400/stoktok-worker@sha256:<64×0>:x` (garbage after the digest) → `rc_is 2` | S6 regex is anchored |
| same › `t_client_image_pin`: second run with `--worker-image "$digest"` (the real `postgres:17` RepoDigest as a stand-in) instead of `--skip-migrate` → `rc_is 1`, `out_lacks "--worker-image must be pinned"`, `out_has "FAILED at step: preflight"`, `assert_no_leak` | A digest-pinned worker image passes S6 (it fails later at preflight because the host does not resolve; the image is never run) |
| same › `t_usage_guards` cert cases (harness:183-192): add `out_has` for "needs MOVE_SRC_SSLMODE verify-ca or verify-full", "needs MOVE_SRC_SSLROOTCERT", "is missing or unreadable", "must be an absolute path", "is not a PEM certificate" | Attempt 1 N2 |
| `pnpm check:deploy-env` with mutations (a)–(j) of AC 2, run by the implementer in a scratch copy and listed in impl-log | AC 2 |

No `packages/core` change, so no Vitest additions (R8 applies to the scripts through `test:move` and `check:deploy-env`).

## Approach
1. **Compose (cutover state).**
   - Header comment:
     - replace the "Expand state (STK-084)" paragraph with a "Cutover state (STK-094)" paragraph: web on `tunnel` + `db` with health check `/readyz` (DB round trip, 3 s client timeout; the route itself times out at 2 s and memoises for 3 s); worker on `default` + `db`; `migrate` is a one-shot on `db` only, run by deploy-stoktok before the app is replaced, never by `up -d` and never on a restore;
     - add "This file reaches the deployment repo only as the second commit of the cutover release PR `release/stoktok-vX.Y.Z` (STK-094); with v0.2.1 pinned it would fail (no `migrate` command, no `/readyz`)";
     - add the hand-run line `docker compose -p stoktok -f apps/stoktok/compose.yml --env-file apps/stoktok/release.env --profile migrate run --rm migrate` before the existing `up -d --wait` line;
     - keep the env-file paragraph, but say that `migrate` shares the env file and has no egress (the TuDo wording at `tudocuatui/compose.yml:22-23`). Never write `NAME=value` in comments: the `apps/stoktok/` env-writer guard greps `STOKTOK_DATABASE_URL=` etc.
   - Web: only the `test:` line changes, to `["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/readyz',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]`. Keep `interval 10s`, `timeout 5s`, `start_period 20s` and `retries 3`.
   - New service after `stoktok-worker`, before `networks:`:
     ```yaml
       migrate:
         image: ${STOKTOK_WORKER_IMAGE:?STOKTOK_WORKER_IMAGE is unset - pass --env-file apps/stoktok/release.env}
         restart: "no"
         profiles: [migrate]
         env_file: /Users/mingming/.config/stoktok/stoktok.env
         cap_drop: [ALL]
         security_opt: ["no-new-privileges:true"]
         # Worker image entrypoint is `node dist/cli.js`; `migrate` applies db/migrations (copied to /app/migrations).
         command: ["migrate"]
         # `db` only: the migrate run needs no egress.
         networks: [db]
     ```
     The worker image's `ENTRYPOINT ["node", "dist/cli.js"]` (`apps/worker/Dockerfile:31`) and `main()` dispatch `migrate` (`apps/worker/src/cli.ts:70-72`). The deploy calls it as `run --rm migrate` (`deploy-stoktok.yml:278`) and finds it with `config --services | grep -qx migrate` (`:252`), so the service name must be exactly `migrate`.
2. **`check-deploy-env.sh`.** Keep every existing check. Change or add:
   - A helper `svc_block NAME` (awk, bash-3.2-safe) that prints the lines from `^  NAME:` up to, not including, the next `^  [A-Za-z0-9_-]+:` or `^[^[:space:]#]` line. Use it for `web_block`, `worker_block` and a new `migrate_block`. Today `worker_block` runs to `^networks:` and would swallow the `migrate` block.
   - The `env_file` count: every service has one. Count of `^\s*env_file:` ≥ 3, and each of the three blocks contains `env_file:`.
   - Web: the block contains the line with the literal `fetch('http://127.0.0.1:3000/readyz',{signal:AbortSignal.timeout(3000)})` and no `/healthz`. No `profiles:`.
   - Worker: unchanged rules (`default`, `db`, `profiles: [jobs]`).
   - Migrate: the block contains exactly these lines (whitespace-trimmed compare):
     - `image: ${STOKTOK_WORKER_IMAGE:?` as a prefix,
     - `restart: "no"`,
     - `profiles: [migrate]`,
     - `command: ["migrate"]`,
     - `networks: [db]` (exact, so `default` and `tunnel` are refused),
     - `cap_drop: [ALL]`,
     - `security_opt: ["no-new-privileges:true"]`.
     
     It has no `healthcheck:`, no `ports:` and no `environment:` key.
   - The existing interpolation, secret-literal, `ports`, `container_name`, `:latest`, `env_file` path and env-writer checks stay as they are and now cover `migrate` as well.
   - Comment header line: "STK-094: cutover state (migrate + /readyz)".
3. **S6 and N1 in the move script.**
   - After script:105 add:
     ```bash
     if [ -n "$IMAGE" ] && [ "$SRC_LOCAL" = 0 ] && ! [[ "$IMAGE" =~ ^[A-Za-z0-9._/:-]+@sha256:[0-9a-f]{64}$ ]]; then
       usage_err "--worker-image must be pinned by digest (<repo>[:tag]@sha256:<64 hex>) for a remote source: use STOKTOK_WORKER_IMAGE from the release PR's release.env"
     fi
     ```
     It runs before `trap cleanup EXIT` and before the password prompt, so it is a usage error (exit 2) and nothing is contacted. Add one line to the S6 header comment (next to the line-6 F4 note).
   - N1: immediately before the `toc=` line (script:359), add `PG_SSL_CUR="prefer"; PG_CERT_CUR=""`.
   - `docs/deploy.md` "Data move script" input bullet for containers: add "a remote source also needs `--worker-image` pinned by digest (exit 2 otherwise); stages 1 and 3 use the digest-pinned `STOKTOK_WORKER_IMAGE` from the release PR".
4. **Runbook fixes (`docs/deploy.md`).**
   - **Attempt 3 N1:** in the rows "Release, `migrate` failed", "Release, web unhealthy" and "Inside the 14 days", change "freeze again (stage 2.3-2.5)" to "freeze again (stage 2.3-2.6)".
   - **Attempt 3 N2:** in the "`migrate` failed" row, before "start it and bootstrap the agent by hand as in Freeze", check first:
     - `docker ps --filter label=com.docker.compose.project=stoktok` prints no container;
     - `docker inspect -f '{{.Config.Image}}' $(docker compose -p stoktok ps -a -q stoktok-web)` names `…stoktok-web:v0.2.1@sha256:…`.
     
     If either check fails, freeze again, stop and report. Use the compose lookup, not the literal name `stoktok-web` that the ticket note mentions: compose names the container `stoktok-stoktok-web-1`, so `docker inspect stoktok-web` would fail.
   - **Attempt 3 N3:** after the first "must read `deployed: ... v0.2.1 ... is running and healthy.`", add one sentence saying how to read the suffixes:
     - " Scheduler NOT installed: see the run." means v0.2.1 is up but the scheduler is not. Bootstrap the agent by hand as in Freeze and check it with `launchctl print`; this suffix alone is not a reason to freeze again.
     - " Env dir not excluded from Time Machine." is harmless.
     - Any other text before or instead of `deployed:` means freeze again.
     
     The other two rows refer to that sentence ("suffixes as above").
   - **Attempt 2 N1 / Attempt 1 N3 (stage 4.2):** `ls -t ~/srv/backups/postgres/last/stoktok-[0-9]*.dump | head -n 1`. Then a timestamp check: the copied file's name (`stoktok-YYYYMMDD-HHMMSS`) must be later than the stage 4.1 merge time, or `ls -l` shows a modification time after the merge. Otherwise report it and do not continue to stage 5.
   - **Attempt 2 N2 (14-day row, step 2):** make the dump mandatory. "Take one now: `docker compose -p postgres -f ~/srv/postgres/compose.yml exec -T pg-backup /backup.sh`. Then copy the newest `~/srv/backups/postgres/last/stoktok-[0-9]*.dump` (it must be the one just written) into `~/srv/backups/stoktok-cutover/` with mode 600."
   - **Attempt 2 N3:** add to the 14-day row: "If a fix-forward release was merged after vX.Y.Z, reverting only the release PR does not bring back v0.2.1; revert every stoktok release PR merged since, newest first, in one deployment PR, or stop and report." The existing "must read v0.2.1" check catches this case too.
   - **Attempt 1 N4 (stage 1.1):** `… psql -U postgres -c "create database stoktok_scratch owner stoktok" -c "revoke all on database stoktok_scratch from public"`.
   - **Attempt 1 N6 (stage 0.6):** "If the IDs differ, take the digest of the image the running Postgres uses: `docker image inspect -f '{{index .RepoDigests 0}}' "$(docker inspect -f '{{.Image}}' $(docker compose -p postgres -f ~/srv/postgres/compose.yml ps -q postgres))"`, and export that as `PG_CLIENT_IMAGE`."
   - **Stage 0.3:** "The PR changes exactly two files, `apps/stoktok/release.env` and `apps/stoktok/compose.yml` (`gh pr diff <n> --repo mmlabs-online/deployment --name-only`), and its `pr-scope` check is green. The compose commit equals the draft at the tag (see 'Cutover release (STK-094)')."
   - **Other sections:**
     - Flow line 6: "`up -d --wait` on the compose health check (`/readyz`, which pings the database, from the cutover release on; `/healthz` before)".
     - Shared Postgres step 3: point to the new subsection.
     - Paragraph at line 105: the draft compose is now in the cutover state and reaches the deployment repo only through the release PR. Production stays on the expand compose until stage 4.
     - "Cut a release" step 8: "From the cutover release on, the health check pings the database (`/readyz`); this dry run also checks the worker side."
   - **New subsection "Cutover release (STK-094)"** under Shared Postgres (≤ 12 lines). It contains sequence steps B–D and the "new version if the dry run needs a fix" rule from the section below, in short. Write no version-specific digests.
5. **ADR 0003.**
   - Status: append "STK-094".
   - Line 11: "`stoktok-worker` stays on the project default network" becomes "`stoktok-worker` is on the project default network (egress) and `db`".
   - Line 15: "Health is `/readyz` (a database round trip, 2 s server timeout, 3 s client timeout) from the cutover release on; `/healthz` (no database) stays as liveness and version endpoint."
   - New "## Amendment (STK-084/STK-094, 2026-11-18)": shared Postgres on the `db` network; a one-shot `migrate` service on the worker image (profile `migrate`, `db` only) that deploy-stoktok runs after a pre-migration dump and before replacing the app; a restore never migrates; the health check moves to `/readyz` in the same release PR, because the previous image has neither.
6. **README of the drafts.** Replace the STK-084 paragraph with: STK-092 and STK-093 are merged. The workflow draft equals the live file. `apps/stoktok/compose.yml` is in its cutover state and goes only into the release PR `release/stoktok-vX.Y.Z` as a second commit, copied from the release tag. Never copy it in a setup PR while v0.2.1 is pinned (F3/F4).
7. **ming-todo.**
   - Line 47: "**7. After the cutover**: rotate the Supabase database password (after a successful cutover, and after any outcome if stage 0.8 fell back to `require`) …".
   - Line 40: add "release PR has exactly `release.env` + `compose.yml`, `pr-scope` green".
   - New item before stage 0: "[ ] **Approve the cutover release**: the orchestrator cuts `release/v0.3.0` from the STK-094 merge commit and adds the compose commit to deployment PR `release/stoktok-v0.3.0`. Do not merge that PR before stage 4. Close any stale `release/stoktok-v0.2.2` PR unmerged."
8. **Release review** (impl-log only). Run the commands under `## Release readiness` and fill the table. Fix nothing found there. Mark each row OK or BLOCKING-FOR-CUT.
9. Run every check (AC 14) and the mutations (AC 2, AC 4).

Rules:
- **R3:** no credential or real digest is committed. S6 tightens which image receives the DB URL. `migrate` reads the URL only from the env file (no interpolation, no argv).
- **R5:** n/a.
- **R7:** only the files listed in the table above.
- **R8:** script changes are covered by `test:move` and `check:deploy-env` with mutation proof.
- **R10:** n/a.
- Nothing touches Supabase: the runbook only reads it, through the script.

## Release readiness (review of `v0.2.1..origin/main`)
The planner has no shell, so it could not run `git log`. The rows below are static findings from the working tree. The implementer re-runs each command on `origin/main` (fetch first, `git fetch origin --tags`) and records the output summary in impl-log. The reviewer re-runs R-1 to R-3.

| # | Check | Command (on origin/main) | Expected (planner's static reading) | Blocking if |
|---|---|---|---|---|
| R-1 | No Supabase data API at runtime | `git grep -nE "@supabase/supabase-js\|createServiceClient\|SUPABASE_SERVICE_ROLE_KEY\|\bSUPABASE_URL\b\|\.rpc\(" origin/main -- apps packages ':!*.test.ts' ':!**/test/**' ':!**/test-db/**'` | Only Auth: `apps/web/server/auth/authen-client.ts` and `apps/web/server/auth/config.ts` (`AUTHEN_SUPABASE_URL`/`_ANON_KEY`). No `supabase-js` in `packages/*`. `apps/web/package.json` keeps `@supabase/ssr`/`supabase-js` for Auth. | any data read or write through Supabase (a `.from(`, an `.rpc(`, the service-role key) |
| R-2 | Migrations | `git diff --name-status v0.2.1 origin/main -- db/migrations supabase/migrations`; `git ls-tree --name-only origin/main db/migrations/` | `db/migrations/` = `20261111000200_baseline.sql` + `README.md` only. Supabase migrations through `20261110000300` were applied to Supabase in order; `20261111000100` never was, by design (STK-083 plan A5; ADR 0011). So at stage 4, `migrate` must print `up to date`. | any `db/migrations` file after the baseline that is not expand-compatible with the Postgres copy, or a Supabase migration after `20261110000300` other than `20261111000100` (the dry-run schema check would fail) |
| R-3 | Env names the release reads | `git grep -nhoE "process\.env(\.[A-Z_]+)?\|env\[[A-Z_]+\]\|[A-Z][A-Z0-9_]+_ENV\b" origin/main -- apps packages ':!*.test.ts' ':!**/test*/**'`, then resolve the `*_ENV` constants (`packages/db/src/pg/client.ts:10-11`, `apps/web/server/auth/config.ts`, `packages/ai/src/env.ts`) | `STOKTOK_DATABASE_URL`, `STOKTOK_AI_KEYS_MASTER_KEY`, `AUTHEN_SUPABASE_URL`, `AUTHEN_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY` (all 6 in the 8-name expand env file, `deploy-stoktok.yml:231`), plus `STOKTOK_VERSION` (compose) and `NODE_ENV` (Dockerfile). | a name the env file and the compose do not supply |
| R-4 | Image and release plumbing | `git diff --stat v0.2.1 origin/main -- apps/web/Dockerfile apps/worker/Dockerfile scripts/check-image.sh .github/workflows/release.yml` | Worker image: entrypoint `node dist/cli.js`, migrations at `/app/migrations` (`apps/worker/Dockerfile:29-31`). `check-image.sh` still passes in `release.yml`'s verify step. | an image change that the migrate service or `/readyz` depends on and that `check-image.sh` does not cover |
| R-5 | Contents | `git log --oneline --merges v0.2.1..origin/main` (map PRs to tickets) and `git log --oneline --no-merges v0.2.1..origin/main \| wc -l` | v0.2.1 predates STK-072 (STK-093 review: v0.2.1 reads no `ANTHROPIC_API_KEY` and no `STOKTOK_DATABASE_URL`). So the release carries roughly STK-061/062 (if not already in v0.2.1) through STK-096: the AI foundation and keys (app-side, ADR 0011), the pg + Kysely data layer, the migrate runner, `/readyz`, the self-hosted font, Vietlott core and schema (no UI). List each ticket. Each must be `DONE` in `work/backlog.md`. | a merged ticket whose state is not DONE, or any `BUG-xxx` S1 still open that touches a merged path |
| R-6 | Auth and allowlist compatibility (rollback safety) | `git grep -l requireUser v0.2.1 -- apps/web`; `git grep -n ALLOWLIST v0.2.1 -- apps` | v0.2.1 already has Supabase-Auth login without an allowlist (runbook stage 5.4 "Auth is still Supabase"; the expand env file without `ALLOWLIST_USER_IDS` runs v0.2.1 healthy). Then ming-todo lines 13-16 ("Login — before the next release") are historical and Ming can tick them. | v0.2.1 has no auth, so v0.3.0 would be the first auth release and the "Restore auth" order (Supabase Auth settings, Ming's user) must be done before stage 4. Or v0.2.1 reads `ALLOWLIST_USER_IDS`, so a rollback to v0.2.1 would lock Ming out (Remove-the-allowlist warning). Ask Ming in both cases. |
| R-7 | Unscheduled jobs | `git show origin/main:deploy/deployment-repo/apps/stoktok/run-schedule.sh` | Unchanged chain (`eod-prices`, `financials`, `signals`). `news`, `financial-statements` and `resolve-holiday-gaps` are not scheduled (known follow-up, STK-084 plan). | — (informational) |
| R-8 | Build flakiness | — | ming-todo "Decisions": `next build` intermittently aborts on a security advisory. If `release.yml` fails after the tag step, the version is consumed; cut v0.3.1. | — (informational; the orchestrator tells Ming before the cut) |
| R-9 | Stale release attempt | `git ls-remote --tags origin 'v0.2.2' 'v0.3.0'`; `git ls-remote --heads origin 'release/v0.3.0'`; `gh pr list --repo mmlabs-online/deployment --state open --search 'head:release/stoktok-'` | `origin/release/v0.2.2` exists (`2a61290`) with no local tag. Expected: no tag v0.3.0, no branch `release/v0.3.0`, no open `release/stoktok-*` PR. | an open `release/stoktok-v0.2.2` PR (Ming closes it unmerged before the cut), or v0.3.0 already taken (pick the next free version) |

A BLOCKING-FOR-CUT row does not block this ticket's PR. It blocks sequence step B, and the orchestrator brings it to Ming.

## Release and cutover sequence (outward actions)
These are not done by the implementer or the reviewer. "Orchestrator" means the main session, acting only after Ming's explicit OK in the chat. Stage numbers refer to `docs/deploy.md` "Cutover runbook (STK-096)".

| Step | Who | Action | Check |
|---|---|---|---|
| A | Ming | Merge this ticket's stoktok PR. Hold unrelated stoktok merges until step C is done (architect R8). | CI green on main |
| B | Orchestrator, after Ming's OK (one OK covers B and C) | Pre-cut checks: R-9 and the impl-log release table with no open BLOCKING row; `deploy-postgres` #9 and `deploy-stoktok` #10 green, and their ming-todo ticks done (runbook 0.1); STK-090 merged (#75). Then `git fetch origin && git push origin <STK-094 merge sha>:refs/heads/release/v0.3.0`. | `release` run green; tag `v0.3.0` exists; deployment PR `release/stoktok-v0.3.0` is open and changes only `apps/stoktok/release.env`. A failed run after tagging means the next attempt is v0.3.1. |
| C | Orchestrator (same OK) | `git clone` the deployment repo and `git switch release/stoktok-v0.3.0`. Then `git -C <stoktok> show v0.3.0:deploy/deployment-repo/apps/stoktok/compose.yml > apps/stoktok/compose.yml`; `git add apps/stoktok/compose.yml`; `git commit -m "stoktok v0.3.0: migrate service and /readyz health check (STK-094)"`; `git push`. Add a PR comment: "Second commit adds the cutover compose (STK-094). Do not merge before runbook stage 4." | `gh pr diff --name-only` = exactly `apps/stoktok/compose.yml` and `apps/stoktok/release.env`; `pr-scope` green on the new head; `cmp` of the branch file against the tag's draft shows no difference. Pushing to a non-main branch deploys nothing (`deploy-stoktok.yml:33-36`). |
| D | Ming | Runbook stage 0. `WORKER_IMAGE` is taken from the PR's `release.env`. S6 now refuses anything without a digest. | ming-todo stage 0 ticked |
| E | Ming | Stage 1, the dry run. If it fails and needs a code fix: close the v0.3.0 deployment PR **unmerged**, fix through a ticket, cut v0.3.1, and repeat C. Never merge a release PR whose dry run failed. | `dry run OK` |
| F | Ming | Stages 2 (freeze) and 3 (move) | `move OK` |
| G | Ming | Stage 4.1: **Ming merges** the release PR (one push to main). deploy-stoktok runs `pull` (migrate found), `backup`, `migrate` (`up to date`), `deploy` (healthy on `/readyz`), `publish`, then `agent`. | PR comment `deployed: … v0.3.0 … is running and healthy.` with no suffix |
| H | Ming | Stages 4.2, 5 and 6 (new Anthropic/Google keys on Settings, revoke the old ones, `ai_keyring_invalid` count 0 on the day and the next day), then stage 7 | ming-todo stages 4–7 ticked |
| I | Orchestrator | After Ming confirms stage 5: CLAUDE.md "Current state" (text under Follow-ups) via `/solo`, or in STK-095. STK-095 starts on day +14. | — |

Rollback for every step follows runbook stage 8; this plan adds no new path. If step C was forgotten, the run shows the `pull` notice "no migrate service yet" and the health check stays `/healthz` (the architect's "partial health check" risk). The stage 0.3 two-file check prevents that.

## Specialist input used
- STK-084 software-architect:
  - F2 (`migrate` on `[db]` only) adopted.
  - F3/F4 (`migrate` and `/readyz` only in the release PR; TuDo M-14 precedent) adopted as P5 and in the README rule.
  - F7 (the release flow builds the images before the deploy, so the dry run can use the release worker image) adopted in the sequence.
  - R2/R3 are already in the STK-096 runbook.
  - R8 (review `git log v0.2.1..main`, freeze unrelated merges) adopted: `## Release readiness`, step A.
  - "What Ming must do" 4–5 (push `release/v0.3.0`, approve the extra compose commit, do not merge yet) adopted as P4/P5 and steps B–C.
  - Risk "partial health check" is covered by the stage 0.3 two-file check.
  - Risk "shared env file widens what each container can read" is accepted as TuDo does, plus P3 hardening.
- STK-084 database-optimizer: no new input for this slice (§1–§12 were handled in STK-084, STK-091 and STK-096).
- STK-084 data-engineer: the smoke list is already in runbook stage 5. Open question 3 (news not scheduled) stays a follow-up (R-7).
- STK-096 review Attempts 1–3 nits and security S6: adopted as listed in Approach steps 3–4. Attempt 1 N5 was already fixed in STK-096.
- Consults for this ticket: none (the orchestrator skipped them; see the ticket note of 2026-11-18).

## Assumptions
- `/home/user/deployment` reflects deployment `origin/main` after STK-093 (deployment#90). Its stoktok compose and workflow equal the drafts (STK-096 review Attempt 2 `cmp`; my read of `apps/stoktok/compose.yml` and the workflow's migrate lines agrees). The implementer re-checks AC 3 with `cmp`.
- deploy-stoktok's `release` step reads `previous` from `$BEFORE:apps/stoktok/release.env`. A single merge of the two-commit release PR is one push, so an automatic restore brings back the expand compose and v0.2.1 together.
- The worker image runs as `node` (`apps/worker/Dockerfile:30`), so `cap_drop: [ALL]` and `no-new-privileges` do not affect `node dist/cli.js migrate`. If `docker compose config` or the stage 1 `--worker-image` leg showed otherwise, that leg uses `docker run` without these options, so stage 4 is the first real test. This is acceptable because a failed migrate leaves the old release running (stage 8 "`migrate` failed" row).
- The `yaml` parse in AC 1 is only a sanity check; `docker compose config` on the Mac (stage 4 `pull`) is the authority.
- No other open ticket (IN_PROGRESS, REVIEW, or DONE but unmerged) edits these files. STK-097 (BACKLOG) will later edit `scripts/check-deploy-env.sh` and should rebase on this ticket.
- The static release findings were read from the working tree (HEAD `9c02909`, which may differ from `origin/main` `23b38b3`). The implementer's `origin/main` run is authoritative.

## Blocking questions
None. The version (v0.3.0), closing any stale v0.2.2 PR and any BLOCKING-FOR-CUT finding are confirmed with Ming at step B, after this ticket's PR. They do not change this plan.

## Split proposal
None. The estimate is about 250 changed lines: compose ~30, check script ~70, move script and harness ~25, docs ~80, ADR ~10, README ~8, ming-todo ~5, plus the impl-log. The outward steps B–I are not code and stay with the orchestrator and Ming; STK-099 is not needed.

## Follow-ups (not in this diff, R7)
- CLAUDE.md "Current state", after stage 5 succeeds: "Current state: the workspace (`apps/`, `packages/`, `db/`) is scaffolded. Production runs on the shared Postgres since the cutover (STK-094, <date>); Supabase holds Auth and, until STK-095, the read-only rollback copy."
- Deploy workflow header line 5, "wait for its health check (/healthz)": make it say "the compose health check". Do this in STK-097's deployment PR (the draft and the live file must change together).
- `news`, `financial-statements` and `resolve-holiday-gaps` are still unscheduled (R-7).
- ming-todo lines 13-16 ("Login — before the next release"): tick or remove them once R-6 confirms v0.2.1 already has auth.
