## Attempt 1 — 2026-11-17 (slice A1)
Verdict: PASS

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0 (all packages).
- lint: `pnpm lint` exit 0, no warnings in output.
- test: `pnpm test` exit 0 — core 834, sources 35, ai 184, db 158, worker 310, web 358 passed (matches impl-log).
- test:db: `DB_TEST_URL=postgresql://postgres:postgres@127.0.0.1:55432/postgres pnpm test:db` against a throwaway local Postgres 16.15 cluster: 26 files, 148 tests passed (matches impl-log). Production is 17; CI runs 17.
- db:check: `DB_CHECK_URL=… pnpm db:check` → `db:check OK` (Postgres 16 locally).
- check:deploy-env: `OK: deploy env lists consistent`; `bash -n scripts/check-deploy-env.sh` OK.
- check:service-key: first run stopped in `next build` with an environment/registry advisory abort from Next.js (not a compile error, unrelated to this diff); the retries passed: `OK: no secret or AI SDK material in client bundle` (0 hits for every needle incl. `db.invalid`, the sentinel password and master key). `/readyz` appears as a dynamic route in the build output.
- Mutations of `check-deploy-env.sh` (scratch copy of the tracked tree, each must exit 1): ahead literal changed, master-key regex line removed, doubled `STOKTOK_STOKTOK_` secret, pwfile grep guard removed, worker `networks: [db]`, web `networks: [tunnel]`, `STOKTOK_DATABASE_URL` mapped from `secrets.`, backup step guard replaced by `always()`, master key dropped from the printf, `backup` step renamed, master-key `missing` line removed, `STOKTOK_DATABASE_URL=` written under `apps/stoktok/` — all 12 exit 1; unmodified copy exits 0.

### Acceptance criteria (plan.md verification table)
- [x] 1 `/readyz` 200 `{"status":"ok"}`, `cache-control: no-store` — `apps/web/test/readyz.test.ts` › "200 ok when the ping resolves" (green); `apps/web/app/readyz/route.ts:17`.
- [x] 2 503 on DataError / getDb throw / 2 000 ms timeout; no error text — readyz.test.ts › "503 on DataError…", "503 when getDb throws…", "503 when the ping never settles within 2000 ms", "clears the timer on success" (green). Body/log carry only event + code (`route.ts:19-21`).
- [x] 3 `/readyz` public — `apps/web/proxy.ts:7`; proxy.test.ts › "lets /login, /healthz and /readyz through…" green; `apps/web/test/entrypoints.test.ts:15` exemption, green; CLAUDE.md R6 note lists `/readyz`.
- [x] 4 `pingDb` via `q()`, DataError without host/password — `packages/db/src/repos/health.ts:7`; `test-db/health.test.ts` (2 tests) green.
- [x] 5 idle-in-transaction 30 s / 60 s; termination survives and pool recovers — `config.ts:15,17`, `client.ts:78-79`; client.test.ts profile assertions; session.test.ts settings test (`1min` worker, `30s` web) and termination test green.
- [x] 6 ahead prefix pinned — `migrate.ts:32,177`; migrate.test.ts › "database ahead applies nothing" asserts prefix and literal; mutation of the workflow literal makes `check:deploy-env` FAIL.
- [x] 7 draft secrets step: derived URL from the pwfile (format-guarded, builtin `read` + assignment, no echo/argv), master key required with `^[A-Za-z0-9+/]{43}=$` guard before `mktemp`, all `SUPABASE_*`/`AUTHEN_*`/AI lines kept, `chmod 600` kept — `deploy-stoktok.yml` secrets step; mutations FAIL as listed.
- [x] 8 `pull` → `backup` → `migrate` → `deploy` guarded on `steps.pull.outputs.migrate == 'true'`; migrate failure exits 1 before `deploy` (deploy `if:` has implicit `success()`; rollback only on `deploy` failure, so the old release keeps running); ahead → `::warning::`, `ahead=true`, notify suffix, exit 0. Step-order check lists the 12 steps.
- [x] 9 draft compose: web `[tunnel, db]`, worker `[default, db]`, external `db`, no `migrate`, health check `/healthz`; interpolation limited to DEPLOY_ONLY (`check-deploy-env.sh:23`).
- [x] 10 `derived` status, `secret_of` name map, printf anchored on its shape in the secrets step — script lines 130-220; OK + mutations.
- [x] 11 `docs/deploy.md` env table (`derived`, `required now`), flow, "Cut a release" step 1, "Roll back", "Shared Postgres (STK-084)" section — read.
- [x] 12 `grep -n 'Apply database migrations' .github/workflows/release.yml` → no match (rc 1).
- [x] 13 CLAUDE.md Stack DB/Runtime/Current state, R6 note, Conventions secrets; spec header, §4 diagram, §4.1, §4.2 bullet, §7 secrets, §9 risk row; ADR 0010 §3 — read.
- [x] 14 production untouched — `git diff --name-only origin/main...HEAD` outside `work/` lists only the plan's files plus the justified `repos-ended-handle.test.ts`; nothing under `supabase/`, no `.env.example` change, no release branch/tag.
- [x] 15 all checks green — above.

Ticket-level AC 3 (master key) is only partly in this slice by design (wiring, guard, doc row); generating/setting the secret is done (Ming, 2026-11-11); new provider keys, Vault cleanup and the `ai_keyring_invalid` log check belong to STK-094/STK-095. Ming verification after merge: none for A1 beyond merging; STK-093 copies the drafts.

### Deviations judged
- **Permanent client `error` listener** (`packages/db/src/pg/client.ts:88-90`): accepted. pg-pool attaches its idle listener only while a client sits in the pool, and a pg `Client` emits `error` with no pending query when the backend is terminated (exactly the idle-in-transaction case), so without a listener Node throws an uncaught `error` event. It is in a planned file, logs only `{event:'db_client_error', code}` (no message, R3), is attached once per connection after successful session init, and a dead client is dropped by pg-pool on release (`_queryable` false) — the recovery assertion in session.test.ts passes. Required to meet AC 5.
- **`pingDb` in `test-db/repos-ended-handle.test.ts`**: accepted. That test enforces a table entry for every index export; adding the export without it fails the suite. One line, test-only.

### Issues
None blocking.

### Rules R1–R10
No violations found. R3: the URL is still read only in `client.ts`; `/readyz` never logs or returns error text; the workflow builds the URL without argv/echo; check:service-key clean. R6: `/readyz` is the only new public path, documented and test-guarded. R7: scope as above. R8: new `packages/db` logic (`pingDb`, profile field, prefix constant, error listener) is covered by unit and test:db tests.

### Nits (do not block)
- `packages/db/test-db/session.test.ts` termination test asserts `toBeInstanceOf(Error)`; the plan said `DataError`. It runs the transaction through `kyselyOf` directly (not `q()`), so a raw pg error is expected — rename the plan wording or wrap in `q()` next time it is touched.
- Draft workflow: a failed `backup` step (or failed `pull`) ends in notify's generic `did-not-complete` message; a dedicated `backup:failed` case would read better in the PR comment.
- Draft secrets step: `grep -Eq` accepts the pwfile if *any* line matches, while `read -r pw` takes the first line. Harmless for a single-line file from `add-app-db.sh`; `head -n1 | grep` or a line-count check would make the guard exact.
- `pull` step pipes `config --services` into `grep -qx` under the default `pipefail` shell; in theory an early grep exit could SIGPIPE compose. Output is a few lines, so not a practical risk.
- `readyz` logs `config` for any non-DataError, non-timeout error (already noted by the implementer).

### Follow-ups (out of scope)
- spec §4.2 still has the open question about "how the app DB's RLS trusts the Authen JWT" and §9 open question 1; both are moot with no RLS on the shared Postgres — tidy in STK-094 or a docs ticket.
- STK-093 must verify `$HOME/srv/postgres/compose.yml` and `/backup.sh` against the live deployment repo (plan assumption).
- `news`, `financial-statements`, `resolve-holiday-gaps` not scheduled (plan follow-up).
