## Attempt 1 — 2026-11-18

Implementer part only. No release cut, no push, no `release/*` branch, no tag, nothing changed in `/home/user/deployment`, no PR (steps A-I stay with Ming and the orchestrator).

### Files touched
| File | Required because |
|---|---|
| `deploy/deployment-repo/apps/stoktok/compose.yml` | Cutover state: `migrate` service, web health check `/readyz` with `AbortSignal.timeout(3000)`, header comment (AC 1) |
| `scripts/check-deploy-env.sh` | Pins the cutover state: `svc_block` helper, env_file on 3 services, web `/readyz` and no `/healthz`, exact `migrate` lines (AC 2) |
| `scripts/db-migrate-from-supabase.sh` | S6 digest guard for `--worker-image` on a remote source; N1 reset of the TLS state before the `pg_restore -l` leg |
| `scripts/test-db-migrate-from-supabase.sh` | S6 asserts in `t_usage_guards` and `t_client_image_pin`; N2 message asserts for the cert guards |
| `docs/deploy.md` | Runbook fixes (N1-N4 of attempt 3, attempt 2 N1/N2/N3, attempt 1 N4/N6, stage 0.3), Flow line, Shared Postgres step 3 and `/readyz` paragraph, new "Cutover release (STK-094)", Cut a release step 8, `--worker-image` bullet |
| `docs/adr/0003-deploy-and-scheduling.md` | Status, network line, health line, amendment |
| `deploy/deployment-repo/README.md` | The cutover compose reaches the deployment repo only as the second commit of the release PR |
| `work/ming-todo.md` | Item 7 wording, stage 0 two-file check, new "Approve the cutover release" item |

### Tests added / changed
- `scripts/test-db-migrate-from-supabase.sh` › `t_usage_guards`: undigested `--worker-image` with a remote source -> exit 2 and message; digest followed by `:x` -> exit 2; message asserts for the five cert guards.
- same › `t_client_image_pin`: digest-pinned `--worker-image` passes the S6 guard (exit 1 at preflight, no pin complaint, no leak).
- `check-deploy-env.sh` mutations (a)-(j), see below.

### Checks (actual output summary)
- typecheck: rc 0. lint: rc 0. test: rc 0 (core 834, sources 35, ai 184, db 169, worker 310 tests passed; web green).
- test:db: rc 0, 27 files / 154 tests passed, against a throwaway local PG 16 (password superuser over TCP 127.0.0.1, data dir under /var/tmp). The cluster was stopped and its directory deleted afterwards (`ls /var/tmp | grep stk094pg` empty). Password never printed.
- db:check: `db:check OK` (default throwaway socket cluster, PG 16, so the "server major must be 17" check only warns locally).
- check:deploy-env: `OK: deploy env lists consistent`. check:service-key: `OK: no secret or AI SDK material in client bundle` (its internal `next build` aborted once on the known npm advisory fetch, passed on rerun, no apps change in the diff). `pnpm build`: rc 0.
- format: stoktok has no `format` / `format:check` script, so none was run.
- `bash -n scripts/*.sh deploy/deployment-repo/apps/stoktok/*.sh`: all pass (host bash; no bash 3.2 container, so `t_static` was not run).
- Compose parse: no docker daemon; `python3 yaml.safe_load` gives services `stoktok-web, stoktok-worker, migrate` and migrate exactly as planned. Not `docker compose config` (stage 4 `pull` on the Mac is the authority).
- test:move: no Docker daemon. Ran from a scratch tree outside the repo (`$S/mv`: copy of `scripts/`, symlinks to db/packages/apps/node_modules) with a host stand-in `docker` (runs the PG 16 client tools on the host, maps /work /secrets /certs, reports `pg_dump 17.0`, `image inspect` returns a fake `postgres@sha256:aaaa...` digest, `ps`/`rm` no-ops) and, in that scratch copy only, `-ge 170000` relaxed to `-ge 160000`. Committed scripts unchanged by the harness setup. Ran `t_usage_guards t_schema_migrations_mismatch t_dry_run_happy t_verify_only t_refuse_non_empty t_force t_schema_drift t_column_pipe t_column_pipe_newline t_extra_source_table t_client_image_pin t_sslrootcert`: 125 ok, 0 FAIL, `test:move OK`. Not run: `t_static` (needs `bash:3.2` container), `t_freeze` (needs a running container). The digest in `t_client_image_pin` is the stand-in's fake one, not a real RepoDigest.
- S6 mutation: guard removed in the scratch copy -> `t_usage_guards` 3 FAILs (exit 2 cases and "no docker call") and the run exits 1; restored afterwards.
- check-deploy-env mutations in a scratch copy of the repo, each FAILs: (a) `/healthz` back; (b) `AbortSignal.timeout` removed; (c) migrate networks `[default, db]`; (d) `[tunnel, db]`; (e) profiles removed; (f) migrate image from `STOKTOK_WEB_IMAGE`; (g1) command removed; (g2) `["migrate","--x"]`; (h) migrate service deleted; (i) worker networks `[db]` (migrate after worker); (j) migrate without env_file.
- AC 3: `cmp` draft vs `/home/user/deployment` (HEAD da06996): `deploy-stoktok.yml`, `run-job.sh`, `run-schedule.sh`, plist identical; `git show HEAD:...compose.yml` equals the live compose (so the working-tree compose differs from live only by this ticket's change). `git diff --stat origin/main -- deploy/deployment-repo/` lists only `apps/stoktok/compose.yml` and `README.md`.
- AC 13: grep of added lines for `sb_secret_`, `eyJ`, real `@sha256:` digests (only 64-zero test fixtures), `postgres://user:pw@`: none.
- Note on AC 7: `grep -n 'stoktok-\*\.dump' docs/deploy.md` still matches stage 4.2's `chmod ... stoktok-*.dump` (the cutover dir, intentional) and two unrelated `daily/stoktok-*.dump` lines; the `last/` glob is now `stoktok-[0-9]*.dump`. `grep -c '2.3-2.6'` = 3.

### Release readiness (`git fetch origin --tags`; origin/main = 23b38b3; commands on origin/main)
| # | Result | Verdict |
|---|---|---|
| R-1 | Only hit: `apps/web/package.json` dependency `@supabase/supabase-js` (plus `@supabase/ssr`, used in `apps/web/server/auth/authen-client.ts` for Auth). No `createServiceClient`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, or `.rpc(` in non-test source; no supabase import in `packages/*`. | OK |
| R-2 | `db/migrations/` = `20261111000200_baseline.sql` + `README.md`. Since v0.2.1 `supabase/migrations` added `20261108000200_news`, `20261109000100_ai_usage`, `20261110000100_ai_reserve_harden`, `20261110000200_ai_keys`, `20261110000300_ai_summaries`, `20261111000100_ai_keys_app_encryption` (the last never applied, by design). Cannot verify from here that the first five were applied to Supabase; the runbook dry run's schema check covers it. | OK (Ming confirms at stage 1) |
| R-3 | Names read in source: `STOKTOK_DATABASE_URL`, `STOKTOK_AI_KEYS_MASTER_KEY` (client.ts), `AUTHEN_SUPABASE_URL`, `AUTHEN_SUPABASE_ANON_KEY` (auth config), `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY` (packages/ai env), `STOKTOK_VERSION`, `NODE_ENV`. All covered by the 8-name env file, compose and Dockerfile. | OK |
| R-4 | Since v0.2.1: `apps/web/Dockerfile` +1 line (`packages/ai/package.json`), `apps/worker/Dockerfile` +2 (`packages/ai/package.json`, `COPY --from=build /repo/db/migrations ./migrations`), `check-image.sh` +67 lines, `release.yml` 2 lines. Migrations are in the worker image as planned. | OK |
| R-5 | 30 merged PRs, 303 non-merge commits since v0.2.1. Tickets seen in commit subjects: STK-062 063 064 069 070 071 072 073 074 075 076 080 081 082 083 084 085 086 087 088 089 090 091 092 093 096; all are DONE in `work/backlog.md` on origin/main. No BUG row that is not DONE. (STK-094/095/097 are not in the range.) | OK |
| R-6 | v0.2.1 already has `requireUser` (many pages and actions). `ALLOWLIST_USER_IDS` appears only in a test asserting it is ignored. So ming-todo lines 13-16 are historical. | OK |
| R-7 | `run-schedule.sh` chain unchanged: `eod-prices financials signals` (before 21:00), `eod-prices signals` (from 21:00). `news`, `financial-statements`, `resolve-holiday-gaps` not scheduled. | informational |
| R-8 | Not testable here. `next build` aborted once locally on the npm advisory fetch (`check:service-key`), passed on rerun. | informational |
| R-9 | `git ls-remote origin 'refs/heads/release/*'`: `release/v0.1`, `v0.1.2`, `v0.2.0`, `v0.2.1`, `v0.2.2` (`2a61290`). `git ls-remote --tags origin v0.2.2 v0.3.0`: nothing. Local tags `v0.1.0 v0.1.1 v0.2.0 v0.2.1`. So v0.3.0 is free and `release/v0.3.0` does not exist. Open `release/stoktok-*` deployment PRs not queryable here (`gh` against the deployment repo not used): Ming/orchestrator must check and close any `release/stoktok-v0.2.2` PR unmerged. | OK, plus one open question for step B |

No BLOCKING-FOR-CUT row from what could be run.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- CLAUDE.md "Current state" after stage 5 (text in plan.md Follow-ups); deploy workflow header line 5 "(/healthz)" for STK-097; unscheduled `news`, `financial-statements`, `resolve-holiday-gaps`; ming-todo lines 13-16 can be ticked or removed (R-6).
- Runbook stage 4.2 timestamp check is manual; a one-line script would be sturdier (not needed now).
- `t_static` and `t_freeze` need a real Docker; CI runs them, they were not run here.

### Scope self-check
- Could the diff be smaller? No; every hunk maps to a plan item.
- Diff size: about +130 / -31 lines over 8 files, plus this log.

## Attempt 2 — 2026-11-18 (REWORK: Ming's note after attempt 1 PASS; security 🟡1, 🟡3, 🟡4, 🟡5, review nit 1 and 4)

### Files touched
- `scripts/check-deploy-env.sh`: migrate block key allow-list (`image restart profiles env_file cap_drop security_opt command networks`); the migrate image line is now an anchored regex `^image: ${STOKTOK_WORKER_IMAGE:?...}$` (🟡3, nit 1).
- `scripts/db-migrate-from-supabase.sh`: `--worker-image` for a remote source must match `mingming21400/stoktok-worker:vX.Y.Z[-pre]@sha256:<64 hex>` (the deploy-stoktok.yml:105 pattern; message keeps "--worker-image must be pinned by digest"); the script's own `docker run ... migrate` gets `--cap-drop ALL --security-opt no-new-privileges:true`; header comment on the source-local exemption (🟡4).
- `scripts/test-db-migrate-from-supabase.sh`: S6 asserts the message for the `@sha256:<64>:x` case (🟡5), a new "digest of another repository" case (exit 2 + message), and the positive worker-image case now uses a `mingming21400/stoktok-worker:v0.3.0@sha256:0...0` value.
- `docs/deploy.md`: "Cutover release" step 5 converts the PR to draft (`gh pr ready --undo`); stage 0.3 requires "draft"; stage 4.1 marks it ready first (🟡1).
- `work/ming-todo.md`: the cutover item says the PR is a draft, mark ready at 4.1; the stale `release/stoktok-v0.2.2` sentence removed (nit 4).
Each is required by the listed finding. `plan.md` step C (orchestrator, `gh pr ready --undo` after the compose push) was not edited; docs/deploy.md carries the instruction.

### Tests and mutation proofs (scratch copy / temporary edit, restored)
- check-deploy-env.sh (scratch copy under the scratchpad): `privileged: true` in migrate -> exit 1 "keys outside the allow-list: privileged"; `volumes:` (docker.sock) -> exit 1; image line with a suffix `:evil` -> exit 1; image line with a prefix -> exit 1. Unmodified tree: exit 0.
- S6: reverting the repository pin to the generic regex -> 2 new asserts FAIL (other repository exit 2 + message); changing the message text -> the 3 message asserts FAIL. Unmodified: `t_usage_guards` passes.
- Not mutation-tested: the `--cap-drop/--security-opt` flags on the script's `docker run migrate` (the harness has no `--worker-image` run with a local source; stage 1 of the runbook exercises it).

### Checks
- typecheck, lint, test (apps/web, apps/worker, packages): green. `format:check`/`format` do not exist in this repo's scripts.
- test:db (throwaway PG 16 on 127.0.0.1:55432, password superuser over TCP, data dir under /var/tmp, deleted afterwards): 27 files / 154 tests passed. db:check: OK (server 16, not 17, warns locally).
- check:deploy-env: OK. `bash -n` on scripts/*.sh and deploy/.../apps/stoktok/*.sh: clean.
- test:move with a host docker stand-in outside the repo (a Python script in the scratchpad that runs pg_dump/psql on the host, maps /secrets and /work, emulates ps/rm/run -d and `image inspect`; committed scripts unchanged): 114 ok, 23 FAIL, and the 23 failures are identical to the baseline run on the stashed tree (111 ok, same 23). Cause: only PG 16 is available, the script requires target >= 17 ("target server is below Postgres 17"), plus the bash 3.2 syntax checks that need bash 3.2. The full move was therefore not exercised here; the usage-guard and client-image-pin tests (all S6 asserts) pass.

### Out-of-plan files
None.

### Follow-ups
- 🟡2 and 🟡6 stay in STK-097 as Ming said. plan.md step C still lacks the draft step (orchestrator action).
- Pre-existing: web/worker network checks are "contains" (`[tunnel, db, default]` passes).

### Scope self-check
Only the listed findings were changed; no deployment repo, release, push or PR.
