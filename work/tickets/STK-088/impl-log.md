## Attempt 1 — 2026-11-12

### Files touched
| File | Required because |
|---|---|
| packages/db/src/migrations-lint.test.ts | AC1-4: NOT_IDENT lookbehind + `u` flag + non-ASCII tag class, block-comment ban, exported BASELINE_DO_RE, new FORBIDDEN entries, fixtures |
| packages/db/src/legacy-reference-guard.test.ts | AC6-7 (new): repo walk, needle, allowlist, fixtures |
| db/migrations/README.md | AC5: reword line 3, "no block comments" bullet |
| scripts/db-check.sh | AC8-9: URL regex `@` refusal, reserved DB_CHECK_APP names, connect error, header/refusal text |
| packages/db/src/pg/migrate.ts | AC10: comment-only change on the guardValue line |

### Tests added / changed
- migrations-lint.test.ts › tokeniser bypass fixtures (extended), block comment fixtures (new), migrating guard fixtures (new), role/schema/owner fixtures (extended), baseline do-block fixtures (uses BASELINE_DO_RE, plus negative), baseline is plain create (uses BASELINE_DO_RE)
- legacy-reference-guard.test.ts › no legacy migration paths outside the allowlist, matcher fixtures, allowlist fixtures

Deviation from plan: the fixture `select $é$ grant $é$;` -> `[]` is wrong, because `stripComments` deliberately keeps dollar-quoted bodies (FORBIDDEN words inside them are still flagged, conservative). Replaced with `select $é$ commit; $é$;` -> `[]` (transaction control is checked on `stripLiterals`, which hides the body).

### Checks (actual output summary)
Local environment (Windows, no `psql`, `node_modules` incomplete) cannot run the full suite; same failures exist on the unchanged baseline (verified with git stash).
- typecheck: `pnpm typecheck` fails in packages/ai ("Cannot find type definition file for 'node'", missing deps, pre-existing). `tsc --noEmit` in packages/db reports no errors in my files.
- lint: `pnpm lint` apps/web and apps/worker Done; `@stoktok/db` eslint clean. packages with missing node_modules warn.
- test: `packages/db` vitest: 17 failed / 6 passed files; the same 17 files fail on the baseline (missing deps/DB; incl. r3-guard on `\` paths). The three files of this ticket: 2 files, 12 tests, all pass.
- test:db and db:check: NOT run (no Postgres/psql locally). CI must run them.

db-check.sh proofs (no Postgres needed):
- `DB_CHECK_URL='postgresql://localhost?@remote/postgres'` -> refusal text, exit 1
- `DB_CHECK_URL='postgresql://u@localhost:5432?x@remote:5432/postgres'` -> refusal text, exit 1
- `DB_CHECK_URL='postgresql://u@localhost:1/postgres'` -> passes regex, "db:check: cannot connect (libpq rejected DB_CHECK_URL or the server is unreachable; the URL is not printed)", exit 1 (here also a "psql: command not found" line from the shell)
- `DB_CHECK_APP=stoktok_nobody` and `=dbcheck_canary` -> "DB_CHECK_APP must not be a db:check role name", exit 1

Guard negative proof: appended `# see supabase/migrations` to scripts/db-check.sh -> guard failed with `['scripts/db-check.sh:224']`; reverted.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Lint does not flag `standard_conforming_strings` / `backslash_quote` changes or backslash-led lines (consult, rejected as out of scope).
- Local Windows dev cannot run packages/db tests (missing deps, no psql); not investigated.
- Plan step 1 "rebase on main": local `main` is already an ancestor of the branch, nothing to rebase.

### Scope self-check
- Could the diff be smaller? No.
- Diff size: about +57 / -14 lines modified files, plus ~70 lines new guard test.
