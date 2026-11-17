## Attempt 1 — 2026-11-17
Verdict: PASS

Reviewed commit 4f84afe (`git diff origin/main...HEAD`). Scope is slice 1 per plan.md; the owner-role test:db is STK-090 and is not expected here.

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0 (all packages Done).
- lint: `pnpm lint` exit 0.
- test: `pnpm test` exit 0. core 834, sources 35, ai 184, db 158, worker 310, web 352 passed. Worker `migrate.test.ts` 9/9 and `cli.test.ts` 23/23 passed (verbose run).
- test:db: local PG16 16.15 on TCP 127.0.0.1:54391, `DB_TEST_URL=postgresql://postgres@127.0.0.1:54391/postgres pnpm test:db`: 25 files, 143 tests passed. `schema-drift.test.ts` 4/4 (parser, fails closed, fixture diff, live comparison with zero drift).
- db:check: throwaway-cluster mode `db:check OK`. URL mode (`DB_CHECK_URL=postgresql://postgres@localhost:54391/postgres`) run against the cluster test:db had just used, matching CI's order: `db:check OK`.
- build: `pnpm build`. The worker built. The first `next build` failed while Next.js ran its security-advisory registry lookup (registry.npmjs.org advisories bulk). This is an environment issue: the diff touches no `apps/web` file. A rerun of `apps/web` `next build` exited 0. The impl-log reports the same behaviour.
- format: the repo has no `format:check` script, so this check does not apply.
- `bash -n scripts/check-image.sh`: OK. shellcheck is not installed.
- Worker bundle (`apps/worker/dist/cli.js`, repo layout):
  - `migrate` with no URL: `migrate failed: STOKTOK_DATABASE_URL is not set`, exit 2.
  - `migrate extra`: usage, exit 2.
  - non-postgres scheme: `... is not a postgres:// URL`, exit 2, and the password is not printed.
  - `postgres://smoke:smoke-pw@127.0.0.1:9/smoke`: `migrate failed: cannot connect to the database (URL not printed)`, exit 1, in 224 ms. No output line matches `smoke-pw|127.0.0.1`.
  - unresolvable host (`nohost.invalid`): same message, exit 1.
  - local PG, first run: `applied 20261111000200_baseline (107 ms)`, exit 0. Second run: `up to date`, exit 0. `schema_migrations` has one row.
  - simulated image layout (`<tmp>/app/dist` next to `<tmp>/app/migrations`): applied, exit 0. With `migrations` removed: `migrate failed: migrations directory not found`, exit 2 (safe fallback).
- Negative proofs, re-run on a scratch copy of the repo (since deleted):
  - r3-guard: I added `// runMigrations` to `apps/web/server/db.ts` and a re-export `export { migrateFromEnv as m }` to `apps/worker/src/jobs/eod-sync.ts`. The new test failed and listed exactly those two paths.
  - drift: I flipped `symbols.exchange` to not null, removed `news.symbols` and added `transactions.ghost_col`. The live test failed with `news.symbols: in db, missing in schema.ts`, `symbols.exchange: nullability schema.ts=not null db=nullable` and `transactions.ghost_col: in schema.ts, missing in db`.

### Acceptance criteria
- [x] 1 `resolveMigrationsDir` returns the image path, then the repo path, then the first candidate. Evidence: `migrate.test.ts` › image layout, repo from src and from dist (neither / both), the real repo. `apps/worker/src/migrate.ts:11-14`. The real-layout runs above agree.
- [x] 2 `migrateCommand` contract. Evidence: `migrate.test.ts` › extra argument, success, MigrationError mapping (with the `[22012]` suffix and exit 2), and unknown error giving fixed text with no echo (rejected Error, non-Error, synchronous throw). `migrate.ts:16-36` never rethrows.
- [x] 3 `main` delegates first and opens no DB. `USAGE` lists `migrate`. Evidence: `cli.ts:70-73` is the first statement of `main`. `cli.test.ts` › `main: migrate delegates and opens no db` and `USAGE lists migrate` pass. The bundle prints `<migrate|...` in its usage line.
- [x] 4 Missing URL gives exit 2 before connecting. Unreachable gives exit 1 with no leak. Evidence: `migrate.test.ts` › real migrateFromEnv (both cases), plus the bundle runs above.
- [x] 5 Dockerfile copies `db/migrations` with no `--chown`. `.dockerignore` keeps `db/`, and `rollback` is never referenced. Evidence: `apps/worker/Dockerfile:29`. `.dockerignore` has no `db` entry. `grep rollback apps/worker/Dockerfile` finds nothing.
- [x] 6 check-image worker block. `bash -n` passes, and I read the script for CI behaviour (see "CI images job assessment" below). **The real proof is the PR's CI `images` job (worker leg).** No PR exists yet, so I cannot cite a run. The orchestrator must confirm that the job is green on the PR before Ming merges. If it is red, the ticket goes to REWORK on `Dockerfile`/`check-image.sh` only (plan A2).
- [x] 7 r3-guard runner rule. Evidence: `r3-guard.test.ts:189-199` passes (identifier regex with fixtures), and my negative proof above fails it.
- [x] 8 Drift test. Evidence: `schema-drift.test.ts` 4/4 on PG16, including the 18-table guard on both sides, the fixtures for a missing column and a nullability flip, and fail-closed cases. My negative proof above fails it in all three directions.
- [x] 9 No legacy path strings. Evidence: `legacy-reference-guard.test.ts` is green in `pnpm test`. A grep of the new and edited files finds none.
- [x] 10 Production untouched. Evidence: `git diff --stat` on `.github`, `apps/web`, `db/rollback`, `db/migrations/*.sql`, `packages/db/src/pg`, `scripts/db-check.sh`, `test-db/{global-setup,harness}.ts`, `CLAUDE.md` and `.dockerignore` is empty. No `release/*` branch exists.
- [x] 11 typecheck, lint, test, test:db and db:check are green (above).

### CI images job assessment (first real run)
Overall, the job is likely to pass. I found no defect in my reading. Step by step:
- **COPY.** The build stage's `COPY . .` brings in `db/migrations`, because `.dockerignore` excludes neither `db` nor `*.sql`. `COPY --from=build` without `--chown` produces root ownership. The files were root-owned in `/repo` anyway, so the result does not depend on BuildKit's ownership-preserving behaviour. Modes come from the runner checkout (644 for files, 755 for directories). `README.md` is copied along; it is a regular file, and the runner ignores non-`.sql` files.
- **Migrate smoke without a URL.** The image ENV has no URL, so `migrateFromEnv` rejects with exit 2 before any filesystem or network access, and stderr is non-empty. `import.meta.url` in ESM `/app/dist/cli.js` resolves to `/app/dist`, so the command uses `/app/migrations` (proven above with the simulated layout).
- **Unreachable migrate smoke.** It behaves the same as the existing `signals` smoke: port 9 refuses at once (224 ms locally), the fixed message contains no host or password, and the result is exit 1. `MNAME` is set before the widened trap.
- **Content check.** It runs as `node` (the default `USER`) under dash with `set -e`. `find` (GNU findutils, which is essential in bookworm-slim and already used on line 18) supports `-mindepth`, `! -type f` and `! -user root`. `test ! -w` uses access(2), which is false for `node` on a root-owned 755 directory. The single and double quotes nest correctly.
- **Existing steps are unaffected.** The `.env*` scan and the ENV-name scan still pass: neither migration file matches them.

### Drift parser strictness
The parser is strict where it matters.
- These cases throw:
  - optional members (`fee?:`);
  - quoted keys;
  - multi-line types;
  - an interface missing from the `Database` map;
  - an unknown, non-exported or `extends` interface named by `Database`;
  - no `Database` interface.
- Because the comparison runs in both directions, most other parse misses still fail loudly. For example, a line hidden behind a `/* */` prefix shows up as "in db, missing", a duplicate (merged) interface shows up as missing columns, and `null | X` shows up as a nullability mismatch.
- I found two narrow silent gaps by probing. Neither applies to today's `schema.ts`: every member is on its own line, and every nullable has a trailing `| null`. Both are listed as nits.

### Issues
None.

### Rules R1–R10
- R3: the URL literal does not appear in any new TS file (the test builds the name with `join`). The worker passes `process.env` to `migrateFromEnv`, which reads it through `client.ts`. No error object or message is echoed for unknown errors.
- R7: every changed file is in the plan's file table, apart from the orchestrator's `work/` files.
- R8: the new logic has unit and real-PG tests, and the checks are green.
- No violations found.

### Nits (do not block)
- `packages/db/test-db/schema-drift.test.ts:24,34`: the member regex `^(\w+):\s*(.+);$` accepts two members on one line (`fee: Int8; tax: X | null;`). It takes the first member's nullability from the combined text and silently drops the second name. Tightening the type group to `([^;]+)` in both places would make that line throw.
- `schema-drift.test.ts:35`: nullability is `| null` anywhere in the type, so `ColumnType<string, string | null, string>` (null in the insert type only) reads as nullable. That matches the ticket's definition, but it can mask a non-null select type. If it matters later, read only the first `ColumnType` argument.
- `scripts/check-image.sh:77-79`: `test -z "$(find …)"` ignores `find`'s own exit status. A `find` error such as a permission failure would produce empty output and pass. The risk is low with root-owned 755 directories.

### Follow-ups (out of scope)
- The root has no `format`/`format:check` script, although the agent rules mention one (already noted by the implementer).
- `next build` depends on a registry advisory lookup that can fail transiently in offline or proxied environments. Consider disabling it in CI and agent runs if it recurs.

## Attempt 2 — 2026-11-17
Verdict: PASS

Scope of this attempt: Ming's note of 2026-11-17 in ticket.md, which asks for security-review 🟡1 and 🟢6 plus the attempt-1 drift-parser and `find` exit-status nits. The diff `adf07d4..d022ace` changes only `scripts/check-image.sh` and `packages/db/test-db/schema-drift.test.ts`, plus the orchestrator's tracker rows (`work/backlog.md` and ticket.md, where Attempts goes to 2 and the note is added).

### Checks (run by reviewer)
- typecheck: exit 0.
- lint: exit 0.
- test: exit 0. Counts: core 834, sources 35 (1 file skipped), ai 184, db 158, worker 310 (1 file skipped), web 352.
- test:db: run against a throwaway PG 16.15 on 127.0.0.1:54329 (`DB_TEST_URL`). Result: 25 files and 145 tests passed.
- db:check: `DB_CHECK_URL=postgresql://postgres:x@localhost:54329/postgres pnpm db:check` printed `db:check OK`. The server is PG 16, not 17.
- `bash -n scripts/check-image.sh`: OK.
- These numbers match impl-log attempt 2. The PG data directory and scratch copy have been deleted.

### Acceptance criteria (Ming's 2026-11-17 fixes)
- [x] **🟡1: `node` cannot write any file under `/app/migrations`, and `find`'s exit status is not ignored.**
  - Code: `scripts/check-image.sh:79-86` now runs every `find` as a plain `f=$(find …)` assignment followed by `test -z "$f"`, and adds `find /app/migrations -writable`.
  - Evidence: I extracted the in-container script verbatim, pointed it at a simulated tree and ran it under `dash` (`/bin/sh` is dash here and in bookworm-slim) with GNU findutils 4.9.0, as the non-root user `nobody`. Results:
    - clean root-owned 644/755 tree: rc 0;
    - file chmod o+w: rc 1;
    - file owned by the runtime user but 444: rc 1 (caught by `! -user root`);
    - directory o+w: rc 1;
    - `*.down.sql` present: rc 1;
    - unreadable subdirectory: rc 1. `dash -x` shows the script stops right after the first `find` prints `Permission denied`, so the exit comes from the find failure through `set -e` and not from a later test.
  - `dash -c 'set -e; f=$(false); echo X'` exits 1 without printing X, which confirms that dash propagates the status of an assignment-only command.
- [x] **🟢6: the no-URL `migrate` smoke runs under `timeout 20`.**
  - Code: `check-image.sh:53` adds `timeout 20`, and `:58` reports a hang on exit 124 before the exit-2 check.
  - This is safe because the outer script uses `set -uo pipefail` without `-e` (line 4), so `code=$?` captures 2 or 124 as intended.
- [x] **Nit: two members on one line throw.**
  - Code: `schema-drift.test.ts:24`, where the regex is now `^\w+:\s*[^;]+;$`.
  - Fixture: "two members on one line fail closed".
  - Proven to fail without the fix: on a scratch copy of the repo I restored the old regex `^\w+:\s*.+;$`, and the fixture failed with 1 failed, 4 passed. With the fix restored, all 6 passed.
- [x] **Nit: `| null` only in a `ColumnType` insert/update position is not nullable.**
  - Code: `selectNullable` at `schema-drift.test.ts:44-50` checks a top-level `null` member, recursing into the first argument of `ColumnType`/`Generated` through a depth-aware `splitTop`. `parseSchemaTs` uses it at `:59`.
  - Fixture: "nullable means the select type is nullable", which has 8 direct cases and one end-to-end case through `parseSchemaTs`.
  - Proven to fail without the fix, on the scratch copy:
    - with both `selectNullable` and the `cols.set` wiring reverted to `/\|\s*null\b/`, the test failed at `:134`, the first `ColumnType<string, string | null | undefined, …>` case;
    - with only the `cols.set` wiring reverted, the end-to-end assertion failed at `:140`.
  - The real `schema.ts` still parses (the test "reads every table" passes), and `fee` is still nullable.
- [x] Scope: only the two named files changed. Neither file touches production code.

### Image-check reading (CI is the first real run)
- **Shell.** The inner script runs under `sh -c` as `USER node` (Dockerfile line 30), and `--entrypoint` does not reset the user. In `node:22-bookworm-slim`, `sh` is dash and `find` is GNU findutils (an Essential package), which supports `-writable` through access(2).
- **Quoting.** The new comment inside the single-quoted block contains no single quote, so the quoting still nests correctly.
- **Expected CI behaviour.** The migrations are root-owned 644 files in a 755 directory (`COPY --from=build` without `--chown`), so every `find` prints nothing and exits 0, and the block passes. This is the same as the clean case in the simulation.

### Issues
None.

### Rules R1–R10
- R3 is unaffected.
- R7: the diff stays within Ming's listed items.
- R8: the new parser logic has unit fixtures, and all checks are green.
- No violations found.

### Nits (do not block)
- `scripts/check-image.sh:53`: the timed no-URL `migrate` run has no `--name`, so the EXIT trap cannot remove it if it ever hangs. `timeout` kills the CLI, and the container may keep running until the runner is torn down. This is harmless on hosted runners. Adding `--name "$MNAME-nourl"` and the trap entry would make it consistent with the other timed smokes.
- `schema-drift.test.ts:32-33`: `splitTop` counts the `>` of `=>` as a closing bracket. No function types appear in `schema.ts`, and the bidirectional diff would surface a misparse anyway.

### Follow-ups (out of scope)
- Unchanged from attempt 1.
