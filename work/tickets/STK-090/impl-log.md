## Attempt 1 — 2026-11-18

### Files touched
| File | Required because |
|---|---|
| packages/db/test-db/owner.ts (new) | Constants, ownerPassword, asOwner, ensureOwnerRole, ownPublicSchema (criteria 1-4) |
| packages/db/test-db/global-setup.ts | Ensure role, template owned by it, migrate as owner, all inside the try (criterion 5) |
| packages/db/test-db/harness.ts | freshDb/emptyDb create with owner and return owner URL (criterion 6) |
| packages/db/test-db/owner.test.ts (new) | Real-Postgres owner tests |
| packages/db/src/test-db-guard.test.ts | Unit tests: ownerPassword, asOwner, ensureOwnerRole, lock key, db:check name guard |
| docs/adr/0010-self-hosted-postgres-data-layer.md | §12 sentence |
| db/migrations/README.md | test:db bullet |

### Tests added / changed
- test-db/owner.test.ts: freshDb owner, template ownership, no escalation, emptyDb, ensureOwnerRole idempotent/concurrent, memberships refused.
- src/test-db-guard.test.ts: ownerPassword (3), asOwner, ensureOwnerRole (5), lock key, db:check names.

### Checks (actual output summary)
Local throwaway PG16 on 127.0.0.1 (scram-sha-256 over TCP, superuser with password), data dir deleted afterwards.
- typecheck: green
- lint: green
- test: core 834, sources 35, ai 184, db 169 (23 files), worker 310, web 360, all passed
- test:db: 27 files, 154 tests passed, all as the owner role (no existing test needed a change)
- db:check (DB_CHECK_URL on the same server, right after test:db): "db:check OK" (PG16 warning expected)
- check:deploy-env: OK; bash -n scripts/*.sh: OK
- No `format:check` script exists; `pnpm format` was run.
- Not done: the temporary negative proof (removing `owner` from freshDb).

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- None.

### Scope self-check
- Could the diff be smaller? No.
- Diff size: about +480 / -9 lines including new files (more than half tests).

## Attempt 2 — 2026-11-18

Fixes: review blocker (owner.test.ts connected the owner role to the admin database `postgres`) and security 🟡1 (stored role settings).

### Files touched
| File | Required because |
|---|---|
| packages/db/test-db/owner.test.ts | Dropped `asOwner(ADMIN)` connection; password check now connects as the owner to a `freshDb()` clone. Real-Postgres assertion: `alter role ... set work_mem`, then ensureOwnerRole, `rolconfig` is null |
| packages/db/test-db/owner.ts | `alter role stoktok_test_owner reset all` inside the same transaction in ensureOwnerRole |
| packages/db/src/test-db-guard.test.ts | Fake-client assertions for the reset on the create and alter paths |

### Checks
Throwaway local PG16 on 127.0.0.1:54390 (scram-sha-256, password superuser, data dir in /var/tmp, deleted afterwards).
- test:db: 27 files, 154 tests passed
- db:check (DB_CHECK_URL, same server): "db:check OK"
- test:db again: 27 files, 154 tests passed
- typecheck, lint: green; test: core 834, sources 35, ai 184, db 169, worker 310, web 360 passed
- check:deploy-env OK; bash -n scripts/*.sh OK; `pnpm format` run

### Out-of-plan files
None.

### Follow-ups
None new.

### Scope self-check
- Smaller diff possible? No (about +16 / -3).
