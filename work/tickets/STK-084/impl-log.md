## Attempt 1 — 2026-11-17 (slice A1)

### Files touched
| File | Required because |
|---|---|
| apps/web/app/readyz/route.ts (new) | D1: public DB-ping readiness route |
| apps/web/proxy.ts, proxy.test.ts | `/readyz` joins PUBLIC_PATHS (AC 3) |
| apps/web/test/entrypoints.test.ts | R6 test exemption for the public route |
| apps/web/test/readyz.test.ts (new) | AC 1-3 |
| packages/db/src/repos/health.ts (new), src/index.ts | `pingDb` via `q()` (D1) |
| packages/db/src/pg/config.ts, client.ts, client.test.ts | D3: `idleInTransactionTimeoutMs` 30 s / 60 s in session init; permanent client error listener (see below) |
| packages/db/src/pg/migrate.ts | D5: exported `MIGRATE_AHEAD_PREFIX`, log text unchanged |
| packages/db/test-db/health.test.ts (new), session.test.ts, migrate.test.ts | AC 4-6 |
| deploy/deployment-repo/apps/stoktok/compose.yml | Expand state: networks `[tunnel, db]` / `[default, db]`, external `db`, header |
| deploy/deployment-repo/.github/workflows/deploy-stoktok.yml | Expand state: derived URL, master key, pull/backup/migrate steps, notify |
| deploy/deployment-repo/README.md | Ordering note for STK-093 |
| scripts/check-deploy-env.sh | AC 6-10 rewrite parts (derived status, secret name map, printf anchor, networks, step order, ahead prefix) |
| .github/workflows/release.yml | AC 12 PR body |
| docs/deploy.md, docs/adr/0010-..., CLAUDE.md, docs/spec-v1.md | AC 11, 13 |

### Tests added / changed
- apps/web/test/readyz.test.ts › 200 ok; 503 on DataError (code-only log, no error text); 503 when getDb throws; 503 on timeout (fake timers); timer cleared on success; source imports only server/db, no requireUser
- apps/web/proxy.test.ts › lets /login, /healthz and /readyz through
- packages/db/test-db/health.test.ts › pingDb resolves; rejects with DataError DB_ERROR, no host/password
- packages/db/src/pg/client.test.ts › profile idle-in-transaction values
- packages/db/test-db/session.test.ts › extended settings test (worker 1min, web 30s); idle-in-transaction termination and recovery
- packages/db/test-db/migrate.test.ts › ahead line starts with MIGRATE_AHEAD_PREFIX
- Mutations on a scratch copy of check-deploy-env.sh all exit 1: ahead literal changed, doubled STOKTOK_ secret name, master-key guard removed, pwfile guard removed, worker `networks: [db]`, doc status `derived` changed.

### Checks (actual output summary)
- typecheck: green (all packages)
- lint: green (all packages, no warnings printed)
- test: core 834, sources 35, ai 184, db 158, worker 310, web 358 passed
- test:db: 26 files, 148 tests passed (local throwaway Postgres 16 cluster, no Docker; production is 17)
- db:check: OK (Postgres 16 locally; the script warns about the major mismatch outside CI)
- check:deploy-env: OK; check:service-key: OK
- `pnpm build`: fails locally at "Generating static pages" with `auth: config invalid` (needs auth env); not a CI step and unrelated to this diff. The worker build succeeds, check:service-key (which builds web with env) passes.
- format: ran `pnpm format`; the repo has no `format:check` script.

### Out-of-plan files
- packages/db/test-db/repos-ended-handle.test.ts: its table must list every index export; added `pingDb` or the test fails.
- Additional edit inside a planned file: packages/db/src/pg/client.ts also gets a permanent `error` listener on the session client (event `db_client_error`, code only). The new idle-in-transaction test proved that without it an idle-in-transaction termination of a checked-out client raised an uncaught exception (process crash), which AC 5 forbids.

### Follow-ups (noticed, not done)
- Plan said `/readyz` returns code `config` for any non-DataError failure; a non-DataError ping error is also logged as `config`. Harmless, but could be refined.
- `pnpm build` locally needs auth env; document or give a build env if wanted.
- Plan assumptions to verify in STK-093: pg-backup path `$HOME/srv/postgres/compose.yml` and `/backup.sh` (from the TuDo workflow); the live workflow lacks the STK-072 AI-key lines, copying the draft ships them.

### Scope self-check
- Could the diff be smaller? No: every file is in the plan table except the two noted above.
- Diff size: see `git show --stat` of the commit.
