Status: READY

# Plan — STK-093: Deployment repo: expand step for stoktok (STK-084 slice C)

Two parts, one review cycle:
- **Part 1, deployment repo.** Create branch `stoktok/expand-shared-postgres` from `origin/main` in `/home/user/deployment`. It copies two reviewed drafts byte for byte.
- **Part 2, stoktok repo.** The carried `check-deploy-env.sh` hardening, a one-line draft fix (`IFS=`), the optional `/readyz` items, and docs.

Part 1 copies the drafts **after** Part 2 has edited them, so the deployment branch matches the stoktok branch exactly.

## Spec summary
- ticket.md Goal: "deployment repo PR: copy the reviewed `deploy/deployment-repo/` drafts from STK-084 verbatim (networks, env file with STOKTOK_DATABASE_URL + master key while keeping SUPABASE_*, mode 0600). The PR body must say it also ships the STK-072 AI-key env lines that never reached the live workflow (both optional)."
- ticket.md AC: "Nothing applies a migration to the Supabase project; no secret is committed." "Repo checks green (stoktok: typecheck, lint, test, test:db, db:check; deployment: its CI)."
- ticket.md notes 2026-11-17 (STK-084 security 🟡5 and nits, carried by Ming's choice): "in `scripts/check-deploy-env.sh` pin that the `$pw =~ $re_pw` guard is followed by `exit 1` within a few lines and comes before the `STOKTOK_DATABASE_URL=` line (reuse the master-key awk pattern); use `IFS= read -r pw`; optional: test that a failed `/readyz` result expires after 3 s, `performance.now()` for the memo clock, a short per-query timeout on the ping; a comment that the config guard assumes the `compose` array convention. Also verify the pg-backup paths against the live deployment repo."
- ticket.md notes 2026-11-17 (STK-092 security review): "give it the same audit (env file mode, no echo of the URL, no `set -x`). If Ming reports the empty `stoktok` dump is ≤ 1 KiB (rclone-sync freshness floor), decide a follow-up here or in STK-094."
- ticket.md notes 2026-11-17: "`deploy-postgres` run was still queued … the `stoktok` role/DB exist on the server only once that run is green … Deployment work goes on a new branch `stoktok/expand-shared-postgres` from origin/main; PR into `mmlabs-online/deployment` (Ming allowed, 2026-11-17)."
- STK-084 plan, Split row C: "Expand PR: copy A1's `deploy/deployment-repo/apps/stoktok/compose.yml` and `.github/workflows/deploy-stoktok.yml` verbatim; v0.2.1 is recreated and must stay healthy; Ming runs `run-job.sh eod-prices --dry-run`". D2: "The compose health check stays on `/healthz` in the expand PR (C)". D6: "C becomes 'copy the reviewed drafts'".
- CLAUDE.md R3: "`STOKTOK_DATABASE_URL` is read only in `packages/db/src/pg/client.ts` … Never in `NEXT_PUBLIC_*`". Conventions: "The database password is `postgres/secrets/apps/stoktok.password` in the deployment repo … written into the host env file by `deploy-stoktok`; the AI master key is the `stoktok` environment secret `STOKTOK_AI_KEYS_MASTER_KEY`."

## Draft vs live diff (done at plan time, `/home/user/deployment` worktree on `main`)
| Live path | Draft | Difference | Verdict |
|---|---|---|---|
| `apps/stoktok/compose.yml` | `deploy/deployment-repo/apps/stoktok/compose.yml` | Only the expand changes. Header lines 14-22: the env file contents, plus a new "Expand state (STK-084)" paragraph. Web `networks: [tunnel]` → `[tunnel, db]`. Worker gets `networks: [default, db]` plus a comment. New `db: {external: true, name: db}`. Lines 1-13 and every other key are identical. | Copy verbatim |
| `.github/workflows/deploy-stoktok.yml` | draft of the same path | Only the expand changes. **Header:** STK-084 paragraph; the STK-072 sentence; "No migrate step" replaced. **`env`:** `DB_APP: stoktok`. **`secrets` step:** `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY` and `STOKTOK_AI_KEYS_MASTER_KEY` in the step env; master-key `missing` line; optional-key and master-key guards; pwfile read and guard; `STOKTOK_DATABASE_URL` assignment; an 8-key `printf` instead of 4 keys. **New steps:** `pull`, `backup`, `migrate`. **`deploy`:** new guard; its `config`/`pull` lines moved to `pull`. **`notify`:** `MIGRATE`/`AHEAD`. `preflight`, `release`, `envdir`, `publish`, `rollback` and `agent` are byte-identical. The STK-072 AI-key lines are the architect's F6 drift: the live file is *behind*, nothing moved on. | Copy verbatim (after the Part 2 `IFS=` edit) |
| `apps/stoktok/run-job.sh`, `run-schedule.sh`, `launchd/online.mmlabs.stoktok.jobs.plist`, `.github/workflows/runner-check.yml` | drafts | Identical | Not in the PR (no change) |
| `apps/stoktok/release.env` | not drafted | Live only. Written by release PRs (v0.2.1, commit `6c6bd10`). | **Do not touch** |
| `.github/CODEOWNERS` | README asks to add `/apps/stoktok/ @didi-code0980` | Already present (line 9) | Nothing to do. The draft README is updated to say so. |

Nothing outside `release.env` has moved on in the live repo, so "copy verbatim" is still right. I could not run `git` (read-only tools), so the implementer re-checks against a fresh `origin/main` (Approach P1.1).

**pg-backup paths, verified against live:**
- The draft `backup` step runs `docker compose -p postgres -f "$HOME/srv/postgres/compose.yml" exec -T pg-backup /backup.sh`.
- Project `postgres`: `postgres/compose.yml:23` `name: postgres`, and `deploy-postgres.yml:45` `PROJECT: postgres`.
- Compose path: `deploy-postgres.yml:46` `PG_DIR: /Users/mingming/srv/postgres`, the runner user's `$HOME/srv/postgres`.
- Service `pg-backup`: `postgres/compose.yml:66`. The image `prodrigestivill/postgres-backup-local:17` provides `/backup.sh`.
- Dumps go to `/Users/mingming/srv/backups/postgres` (`compose.yml:88`).
- The same command is already in production in `deploy-tudocuatui.yml:173`, `deploy-org-admin-api.yml:205`, `deploy-ricotdin-v2.yml:126` (via `PG_COMPOSE`) and `ops/backup/RESTORE.md:191`.
- Verdict: correct. In the expand state the step is skipped anyway: no `migrate` service, so `steps.pull.outputs.migrate == 'false'`.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Deployment branch `stoktok/expand-shared-postgres` (from current `origin/main`) changes exactly `apps/stoktok/compose.yml` and `.github/workflows/deploy-stoktok.yml`, as one commit `stoktok: expand to the shared Postgres (STK-093)` | In `/home/user/deployment`: `git diff --stat origin/main...stoktok/expand-shared-postgres` lists exactly those 2 files; `git diff origin/main...stoktok/expand-shared-postgres -- apps/stoktok/release.env` is empty |
| 2 | Both files are byte-identical to the drafts on the stoktok branch | `cmp /home/user/stoktok/deploy/deployment-repo/apps/stoktok/compose.yml /home/user/deployment/apps/stoktok/compose.yml` and `cmp …/.github/workflows/deploy-stoktok.yml …` both exit 0 (deployment worktree on the branch) |
| 3 | Live drift re-checked at implementation time: on `origin/main`, the only changes to `apps/stoktok/` and `deploy-stoktok.yml` since this plan are in `release.env` | impl-log records `git log --oneline -3 origin/main -- apps/stoktok .github/workflows/deploy-stoktok.yml` and states that the pre-copy `git diff origin/main -- apps/stoktok/compose.yml .github/workflows/deploy-stoktok.yml` against the drafts showed only the hunks in the table above |
| 4 | Deployment CI equivalent green: no volume-deleting command | `bash /home/user/deployment/ops/check-volume-safety.sh /home/user/deployment` prints "No volume-deleting commands found." on the branch. `pr-scope` is a no-op (not a `release/*` branch). After the PR opens, the orchestrator confirms `volume-safety` and `pr-scope` are green |
| 5 | Draft reads the password with `IFS= read -r pw < "$pwfile" \|\| true` | Read `deploy-stoktok.yml` secrets step; `pnpm check:deploy-env` OK |
| 6 | `check-deploy-env.sh` pins the password guard order: `pwfile=` < `IFS= read -r pw` < `re_pw=` < `if ! [[ "$pw" =~ $re_pw ]]; then` < `exit 1` (within 4 lines) < `STOKTOK_DATABASE_URL="postgres://…"` < `mktemp` < the env-file `printf` | `pnpm check:deploy-env` OK. Mutations in a scratch copy (see Tests) must each FAIL |
| 7 | `check-deploy-env.sh` pins that the password and the URL are never echoed: outside the secrets step no non-comment line references `$pw` or `STOKTOK_DATABASE_URL`; inside it, `$pw` appears only on the guard and the URL assignment, and `$STOKTOK_DATABASE_URL` only on the single `printf` | `pnpm check:deploy-env` OK; mutations `echo "$pw"`, `echo "::notice::$STOKTOK_DATABASE_URL"` and `echo "$STOKTOK_DATABASE_URL"` placed after `publish` must FAIL |
| 8 | Comment on the `config` guard says it assumes the `compose=(…)` array / `docker compose` convention | Read `check-deploy-env.sh` near the `compose config` check |
| 9 | Secrets audit (STK-092 request) holds in the copied workflow: env file written under `umask 077` in a mode-700 dir, `chmod 600`, owner+mode `stat` check; no `set -x`/`xtrace`; no heredoc; `config` only with `--quiet`/`--services`; URL built by builtins only (no argv, no echo); error messages name the file path, never a value | Read the secrets step; `pnpm check:deploy-env` (existing checks lines 105-126, 214-252 plus AC 6/7) OK |
| 10 | No secret value anywhere in the diffs, impl-log, commit messages or PR body | `grep -rF -f /home/user/deployment/postgres/secrets/apps/stoktok.password /home/user/stoktok/work /home/user/stoktok/docs /home/user/stoktok/deploy /home/user/stoktok/scripts` finds nothing (never `cat` the file); `git -C /home/user/deployment diff origin/main...stoktok/expand-shared-postgres \| grep -cE '[A-Za-z0-9+/]{43}='` prints 0; the reviewer reads the PR body text in impl-log |
| 11 | `/readyz` memo: a failed result is served for < 3 s, then the ping is retried; the memo clock is `performance.now()` | `apps/web/test/readyz.test.ts` › "memoises a failed result for 3 s, then retries"; existing "memoises the result for 3 s…" still green; read `route.ts` |
| 12 | Docs describe the expand step as it will actually run: preconditions, what happens on the server, Ming's checks, rollback; the "Enable AI keys" section says STK-093 ships the workflow lines; the draft README no longer asks for the CODEOWNERS line | Read `docs/deploy.md` "Shared Postgres (STK-084)" step 2 and "Enable AI keys (STK-072)"; read `deploy/deployment-repo/README.md`; `pnpm check:deploy-env` OK |
| 13 | Nothing touches the Supabase project or applies a migration; stoktok diff only lists files from the table below | `git diff --stat main...` in stoktok |
| 14 | stoktok checks green | `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:db`, `pnpm db:check`, `pnpm check:deploy-env`, `pnpm check:service-key`. If `test:db`/`db:check` cannot run in the sandbox, record it in impl-log as earlier tickets did |

## Files to create / modify
**Deployment repo** (`/home/user/deployment`, branch `stoktok/expand-shared-postgres` from `origin/main`):
| File | Change | Required because |
|---|---|---|
| `apps/stoktok/compose.yml` | Replace it with the draft, byte for byte | Expand: web on `[tunnel, db]`, worker on `[default, db]`, external `db` network |
| `.github/workflows/deploy-stoktok.yml` | Replace it with the draft (after the Part 2 edit), byte for byte | Expand: env file gains `STOKTOK_DATABASE_URL` (derived from the committed password file), `STOKTOK_AI_KEYS_MASTER_KEY`, and the STK-072 AI-key lines, while keeping `SUPABASE_*`/`AUTHEN_*`; guarded `pull`/`backup`/`migrate` steps that stay dormant until STK-094 |

Nothing else changes in the deployment repo: `release.env`, the scripts, the plist, `runner-check.yml` and CODEOWNERS are all left alone.

**stoktok repo:**
| File | Change | Required because |
|---|---|---|
| `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` | `read -r pw < "$pwfile" \|\| true` → `IFS= read -r pw < "$pwfile" \|\| true` (one line) | Carried item: the value checked must equal the file's first line, without whitespace trimming |
| `scripts/check-deploy-env.sh` | (a) pinned literal updated to `IFS= read -r pw …`; (b) awk order check for the password guard (AC 6); (c) no-echo check for `$pw` / `STOKTOK_DATABASE_URL` (AC 7); (d) a comment on the `config` guard (AC 8) | Carried 🟡5 + nits; STK-092 audit |
| `deploy/deployment-repo/README.md` | CODEOWNERS paragraph: the line already exists on deployment `main` (no action). STK-084 paragraph: B (STK-092) is merged; C is this ticket's PR | Drift found while diffing |
| `docs/deploy.md` | "Shared Postgres (STK-084)" step 2 rewritten as preconditions, what happens, checks and rollback (see Approach P2.4). "Enable AI keys (STK-072)" step 2 notes that the STK-093 PR ships the workflow lines, so with that PR merged steps 2-3 need no separate PR or dispatch | Ticket scope (docs) and the ticket's PR-body requirement on STK-072 |
| `apps/web/app/readyz/route.ts` | `Date.now()` → `performance.now()` (one line) | Carried optional item (clock jumps) |
| `apps/web/test/readyz.test.ts` | New test for a failed result and its expiry; fake timers configured so `performance` is faked if Vitest 5 does not fake it by default | Carried optional item; AC 11 |
| `work/tickets/STK-093/impl-log.md` | Implementer log, including the deployment PR body text | Workflow |

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `apps/web/test/readyz.test.ts` › memoises a failed result for 3 s, then retries. Fake timers. `pingDb` rejects once with `FakeDataError('DB_ERROR')`, then resolves. `GET` gives 503. Advance 2 999 ms: `GET` gives 503 and `pingDb` was called once. Advance 1 ms more: `GET` gives 200 and `pingDb` was called twice. Log called exactly once. | AC 11 |
| Existing `readyz.test.ts` memo and timeout tests, still green with `performance.now()`. If Vitest 5's default `toFake` omits `performance`, use `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })` in the fake-timer tests and record which applied. | AC 11, no regression |
| `pnpm check:deploy-env` on the real tree prints OK | AC 5-9, 12 |
| Mutation proofs: copy `scripts/`, `deploy/`, `docs/deploy.md`, `.env.example`, `.github/workflows/release.yml`, `packages/db/src/pg/migrate.ts`, `docs/adr/0003-deploy-and-scheduling.md` into a scratch dir with the same layout. Apply each mutation to the copied draft workflow alone, run `bash <scratch>/scripts/check-deploy-env.sh`, and expect exit 1 naming the check. Mutations: (1) delete the `exit 1` after the `$pw` guard; (2) move the `STOKTOK_DATABASE_URL=` assignment above the guard; (3) `IFS= read -r pw` → `read -r pw`; (4) move `re_pw=` below the guard; (5) add `echo "$pw"` in the secrets step; (6) add `echo "::notice::$STOKTOK_DATABASE_URL"` in the `publish` step; (7) add `set -x` (existing check). Record each output in impl-log | AC 6, 7, 9 |
| `bash -n scripts/check-deploy-env.sh` | Syntax |

## Approach
**P2: stoktok repo first.**
1. Edit the draft line (`IFS= read -r pw < "$pwfile" || true`). No other draft edits.
2. `check-deploy-env.sh`:
   - In the existing literal loop (lines 241-252), replace `'read -r pw < "$pwfile" || true'` with `'IFS= read -r pw < "$pwfile" || true'`.
   - After that loop, add a `pw_ok` awk check on `$secrets_step`. Reuse the master-key awk shape at lines 224-231: trimmed line `l`; exact matches for `pwfile="postgres/secrets/apps/$DB_APP.password"` (f), `IFS= read -r pw < "$pwfile" || true` (rd), `re_pw='^[A-Za-z0-9_-]{16,}$'` (r), `if ! [[ "$pw" =~ $re_pw ]]; then` (g, first after r), the first `exit 1` line with `NR <= g + 4` (x, record its line), `STOKTOK_DATABASE_URL="postgres://$DB_APP:$pw@postgres:5432/$DB_APP"` (u), first `mktemp` (m), first `printf … > "$tmp"` (p).
   - It prints `yes` only when all are set and `f < rd < g`, `r < g`, `g < x < u < m < p`. Otherwise it fails with: `FAIL: the password guard (re_pw, if ! [[ "$pw" =~ $re_pw ]] + exit 1) must follow IFS= read and precede STOKTOK_DATABASE_URL=, mktemp and the printf in the secrets step`.
   - No-echo check. Use `wf_nc` = workflow lines without comment lines, and `out_of_step` = those lines minus the secrets step (`sed '/^      - name: secrets\s*$/,/^      - name: pull\s*$/d'`).
     - FAIL if `out_of_step` matches `\$\{?pw([^A-Za-z0-9_]|$)` or `STOKTOK_DATABASE_URL`.
     - In the secrets step: lines matching `\$\{?pw([^A-Za-z0-9_]|$)` must be exactly the guard line and the URL assignment (count 2, both present). Lines matching `\$\{?STOKTOK_DATABASE_URL` must be exactly 1, the `printf` line.
     - The regex must not match `$pwfile`; the `[^A-Za-z0-9_]` class handles that. bash 3.2-safe: grep/sed/awk only, no `mapfile`.
   - Above the `compose config` check (line 109), add: `# Assumes the convention: compose is run as "${compose[@]}" (array named compose) or "docker compose" on one line; another array name, docker-compose, or a line continuation is not seen.`
3. `route.ts`: `const now = performance.now();` (global in Node 18+, no import). `readyz.test.ts`: add the test from the table and adjust fake timers only if needed.
4. Docs:
   - `docs/deploy.md` "Shared Postgres (STK-084)" step 2 becomes a short block with four parts:
     - **Before merging:** the `stoktok` environment lists `STOKTOK_AI_KEYS_MASTER_KEY`; check whether `STOKTOK_ANTHROPIC_API_KEY`/`STOKTOK_GOOGLE_AI_API_KEY` exist, because they reach the containers for the first time; preferably `deploy-postgres` for B is green; merge outside 18:30-19:30 and 21:00-22:00 Mon-Fri.
     - **What happens:** the summary of "Server behaviour on merge" below.
     - **Checks:** the commands under "Ming verification after merge".
     - **Rollback:** the summary of "Rollback" below.
   - "Enable AI keys (STK-072)": add one sentence: the STK-093 deployment PR carries these workflow lines; once it is merged, steps 2-3 are done.
   - `README.md` edits as in the files table.
   - Keep every `env-list` row unchanged: the key set is unchanged, so the `.env.example` and doc checks still pass.
5. Run `pnpm check:deploy-env`, the mutation proofs, and all checks (AC 14).

**P1: deployment repo, after P2 is final.**
1. `git -C /home/user/deployment fetch origin`. Then run `git log --oneline origin/main -5 -- apps/stoktok .github/workflows/deploy-stoktok.yml` and `git diff origin/main -- apps/stoktok/compose.yml .github/workflows/deploy-stoktok.yml` against the drafts (copy the drafts to a scratch dir and `diff`).
   - If any hunk differs from the table "Draft vs live diff", stop and report instead of copying, e.g. a later live edit to the header, steps or env. That stop is the "live moved on" case.
   - A newer `release.env` is fine; it is never copied.
2. `git switch -c stoktok/expand-shared-postgres origin/main`. Copy the two draft files over the live paths (`cp`, then `cmp`).
3. `bash ops/check-volume-safety.sh .`. Then `git diff --stat origin/main...HEAD` (exactly 2 files).
4. One commit: `stoktok: expand to the shared Postgres (STK-093)`. The body names the stoktok draft paths and the password file **by path only**. Do not push. The orchestrator pushes and opens the PR after review PASS, using the body text from impl-log.
5. PR body (in impl-log), no values:
   - the 2 files are copied verbatim from `mmlabs-online/stoktok` `deploy/deployment-repo/` (stoktok PR link to be added);
   - **it also ships the STK-072 AI-key env lines that never reached the live workflow**: `ANTHROPIC_API_KEY`/`GOOGLE_AI_API_KEY` from optional secrets `STOKTOK_ANTHROPIC_API_KEY`/`STOKTOK_GOOGLE_AI_API_KEY`; unset means empty, so that provider is off; a value outside `^[A-Za-z0-9._-]*$` stops the run at `secrets` with nothing changed;
   - `STOKTOK_AI_KEYS_MASTER_KEY` is now required;
   - `STOKTOK_DATABASE_URL` is derived from `postgres/secrets/apps/stoktok.password` (STK-092);
   - the `SUPABASE_*` lines stay for the rollback window;
   - backup/migrate stay dormant (no `migrate` service until STK-094);
   - the sections "Server behaviour on merge", "Ming verification after merge" and "Rollback" below, condensed.

**Rules.**
- R3: the URL exists only in the host env file (0600) and in the secrets step's shell variable. It is never in argv, an echo, `NEXT_PUBLIC_*` or the stoktok repo. The new checks make this enforced, not just reviewed. The app-side read stays in `client.ts`; nothing changes there.
- R6: `/readyz` semantics are unchanged.
- R7: only the listed files. The optional per-query ping timeout goes to follow-ups.
- R8: checks plus the new test.
- R10: n/a.
- Nothing connects to Supabase or runs a migration. In the expand state the deploy never contacts Postgres at all.

## Server behaviour on merge (deployment PR)
The merge pushes to `main` and touches `apps/stoktok/compose.yml`, so `deploy-stoktok` starts on `macbook-runner`. GitHub runs the workflow file of the pushed commit, i.e. the new one. A workflow-only change would not trigger; this one does, so no `workflow_dispatch` is needed. The runner is shared, so if B's `deploy-postgres` is still queued, this run queues behind it.
1. `preflight`, `release`: `release.env` pins v0.2.1, so `skip=false`, `image` = v0.2.1, and `previous` = v0.2.1 too (BEFORE has the same `release.env`).
2. `envdir`: unchanged (dir 700, Time Machine exclusion).
3. `secrets`:
   - It checks the 4 Supabase/Authen secrets as before, the optional AI keys (empty allowed), and the master key (required, base64 of 32 bytes).
   - It reads `postgres/secrets/apps/stoktok.password` **from the runner's checkout** of the merge commit. The file has been on `main` since STK-092, and the step checks it against `^[A-Za-z0-9_-]{16,}$`.
   - It writes 8 lines to a temp file in the 700 dir, `chmod 600`, `mv`s it over `~/.config/stoktok/stoktok.env`, and checks owner and mode 600.
   - Content differs, so `changed=true`.
   - **This needs neither the `stoktok` role nor the database on the server**: nothing connects to Postgres in this step or later in the expand state.
4. `pull`: `config --quiet`, `pull` with profiles `jobs` and `migrate`. Images are digest-pinned and already present, so this is a no-op. There is no `migrate` service, so `migrate=false` and a `::notice::`.
5. `backup`, `migrate`: skipped.
6. `deploy`: `up -d --wait --wait-timeout 120 --force-recreate`.
   - Only `stoktok-web` is started (the worker is profile `jobs`). Web is recreated on `web` + `db` with the expanded env file, so expect seconds of downtime.
   - v0.2.1 is Supabase-backed and never reads `STOKTOK_DATABASE_URL` or the master key, so it ignores them. `/healthz` does not touch any DB, so the container turns healthy whether or not `deploy-postgres` has created the role and database.
   - The external `db` network must exist. It does: `org-admin-api`, `tudocuatui` and `ricotdin-v2` already run on it, and `deploy-postgres` creates it if missing.
7. `publish`: copies the new `compose.yml` (plus the unchanged scripts, plist and `release.env`) to `~/stoktok/current`. From then on, launchd jobs run the v0.2.1 worker on `default` + `db`; egress stays through `default`.
8. `agent`: the plist is unchanged and loaded, so "scheduler unchanged" and no job is interrupted.
9. `notify`: PR comment "deployed: `…stoktok-web:v0.2.1@…` is running and healthy."

**Failure paths:**
- **Master key missing or malformed, password file missing or malformed, or an optional AI secret with bad characters:** `secrets` fails and names the secret or the file path. Nothing is pulled or started, the old env file stays, v0.2.1 keeps running on the old compose, and the PR comment reads "secrets missing or invalid". Fix the secret, then `workflow_dispatch` on `main`.
- **Web unhealthy, or `db` network missing:** `deploy` fails, and `rollback` restores `apps/stoktok/` from BEFORE: the old compose without `db`, still v0.2.1. The new env file is kept, and its extra keys are harmless to v0.2.1. The rollback then republishes and tries to push a revert commit. Under D5 (no bypass) that push fails, giving `restore-unpushed`. Ming then reverts the PR merge (see Rollback).

## Ming verification after merge
Not reviewer-verifiable: these need the Mac, the GitHub UI and the live site. Run docker as `mingming`. **Never print the env file, and never run `docker inspect` without `-f`: it prints the env.**
0. Before merging: Settings → Environments → `stoktok` lists `STOKTOK_AI_KEYS_MASTER_KEY`. Note whether `STOKTOK_ANTHROPIC_API_KEY`/`STOKTOK_GOOGLE_AI_API_KEY` exist (they now reach the containers). Preferably B's `deploy-postgres` run is green. Merge outside the job slots.
1. The `deploy-stoktok` run for the merge commit is green. The `pull` step shows the notice "no migrate service yet". The PR comment says `deployed: … v0.2.1 … healthy`.
2. `ls -l ~/.config/stoktok/stoktok.env` shows `-rw-------  mingming`. `stat -f '%Lp' ~/.config/stoktok` shows `700`. `cut -d= -f1 ~/.config/stoktok/stoktok.env` (names only) lists the 8 names: `STOKTOK_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTHEN_SUPABASE_URL`, `AUTHEN_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`, `STOKTOK_AI_KEYS_MASTER_KEY`.
3. `docker compose -p stoktok ps` shows web `healthy` with a new start time. `docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' $(docker compose -p stoktok ps -q stoktok-web)` prints `db web`.
4. The site: log in, and the dashboard shows the same data as before (still Supabase).
5. `grep -c 'name: db' ~/stoktok/current/compose.yml` prints `1`. Then `/Users/mingming/stoktok/current/run-job.sh eod-prices --dry-run` exits 0, which proves the worker on `default` + `db` still reaches market data.
6. After B's `deploy-postgres` is green, a TCP check from web (no credentials) should print `ok`: `docker compose -p stoktok exec stoktok-web node -e "require('net').connect(5432,'postgres').on('connect',()=>{console.log('ok');process.exit(0)}).on('error',e=>{console.log(e.code);process.exit(1)})"`. Authenticating with the password is first exercised by the STK-091 dry run.
7. From STK-092 (carried): after `pg-backup /backup.sh`, report the size from `ls -l ~/srv/backups/postgres/daily/stoktok-*.dump`. If it is ≤ 1024 bytes, see Assumptions (follow-up).

## Rollback
- **Automatic** (web unhealthy within 120 s): handled by the workflow, as above. Expect `restore-unpushed`. Then do the manual revert below so `main` matches the server.
- **Manual:** revert the deployment PR's merge commit on `main`, in a PR because `main` is protected; Ming merges. That push touches `apps/stoktok/` and runs the **old** workflow, which rewrites the 4-key env file (`changed=true`, web recreated on `web` only) and republishes the old compose.
- **What is not affected:** the Supabase project, the `stoktok` database (empty, never used here), and `release.env`.
- **If only a secret was wrong:** fix the secret or the file, then `workflow_dispatch` on `main`. No revert needed.

## Specialist input used
No new consult (ticket note: STK-084's consults were written for this slice).
- software-architect F1 (keep `SUPABASE_*`): adopted; it is in the draft.
- F2 (networks): adopted; in the draft.
- F3/F4 (no `migrate` service, no `/readyz` health check yet): adopted; the backup/migrate steps stay dormant.
- F6 (drift: the STK-072 lines never reached live): confirmed by this plan's diff, and it goes in the PR body.
- F8 (`pg-backup /backup.sh`): verified against live.
- R1-C ("compose change … recreates v0.2.1 … should stay green"): spelled out under "Server behaviour on merge".
- What Ming must do, step 3: in "Ming verification after merge".
- STK-084 security review attempt 2, 🟡5 and its notes: 🟡5 pin adopted (AC 6). Config-guard comment adopted (AC 8). Failure-memo test and `performance.now()` adopted (AC 11). The per-query ping timeout is deferred to a follow-up: it is a `packages/db` change with `test:db` coverage, outside this deployment slice. 🟡3 (`::add-mask::`) stays declined by Ming; AC 7 strengthens the "nothing prints it" premise instead.
- STK-092 security review "Risks" (audit this ticket for env mode, URL echo, `set -x`): AC 7 and AC 9. 🟡 dump-size floor: Ming check 7 plus the follow-up rule under Assumptions.

## Assumptions
- **v0.2.1 ignores the new keys.** It is the Supabase-backed release. The pg data layer (STK-081–089) is unreleased (architect R8), so `STOKTOK_DATABASE_URL` and `STOKTOK_AI_KEYS_MASTER_KEY` have no effect on it.
  - Whether v0.2.1 reads `ANTHROPIC_API_KEY`/`GOOGLE_AI_API_KEY` (`packages/ai/src/env.ts`, STK-072) depends on its contents. If it does and Ming has set those environment secrets, the providers turn on with them. That is the intended STK-072 behaviour, and the PR body states it.
- The `stoktok` environment already holds `STOKTOK_AI_KEYS_MASTER_KEY` (STK-084 ticket; architect F5). If not, the run stops at `secrets` with nothing changed: safe, but red.
- **Dump-size floor (STK-092 🟡).** If Ming reports the empty `stoktok` dump ≤ 1 KiB, `rclone-sync.sh:68` fails the nightly offsite sync for **every** database until STK-094 loads data. That is not stoktok-only, so it cannot wait for STK-094.
  - Decision: it is out of this diff (R7; `ops/backup/` is another area).
  - The orchestrator records a P1 deployment-repo follow-up ticket right away. It should be decided before the next 03:30 run if possible; options for that ticket are a per-database floor or excluding a database with no tables.
  - If the dump is > 1 KiB, nothing to do.
- `/home/user/deployment` was read on local `main`; its `.git/HEAD` is `refs/heads/main`. That `origin/main` equals it is unverified (no git in the planner's tools), so P1.1 re-checks.
- `performance` is a Node global in the web runtime (Node ≥ 18); no import is needed.
- No other open ticket edits these files. STK-094 will later edit the same two drafts (cutover state) and depends on this ticket. `src/App.tsx` does not exist in this repo.
- The deployment PR is not a `release/*` branch, so `pr-scope` applies no rule. `/.github/` and `/apps/stoktok/` are code-owned by Ming's handle.

## Follow-ups (not in this diff, R7)
- Short per-query timeout on the `/readyz` ping, so abandoned pings stop holding web-pool connections (STK-084 security note). `packages/db`.
- Draft `notify` has no dedicated message for a failed `backup` step (it falls to "did-not-complete"). Worth a `backup:failed` case when STK-094 activates the step.
- Deployment repo: the offsite-sync size floor for an empty database (only if Ming check 7 reports ≤ 1 KiB, see Assumptions).

## Blocking questions
None.

## Split proposal
None. This ticket is slice C of STK-084: 2 copied files in the deployment repo, plus about 60 changed lines in stoktok.
