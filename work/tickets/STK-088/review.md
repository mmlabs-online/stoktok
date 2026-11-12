## Attempt 1 — 2026-11-12
Verdict: PASS

Diff base: `origin/main` (8daf146, merge of STK-087 PR #65). Local `main` is stale, so `git diff main...HEAD` would show ~380 unrelated files; against `origin/main` the diff has 10 files, and all of them are in the plan's file table or under `work/`.

### Checks (run by reviewer, Windows host after `pnpm install --frozen-lockfile`)
- typecheck: `pnpm typecheck` green (all 6 packages Done, exit 0).
- lint: `pnpm lint` green (core, db, ai, sources, web, worker Done).
- test: `pnpm test` exits 1. core 834/834, sources 35/35, ai 184/184 pass. `packages/db` 139 pass, 18 fail, all in `src/r3-guard.test.ts` (17) and `src/pg/migrate.test.ts` (1). These failures come from the host, not from this diff:
  - r3-guard: the received lists are the allowed files themselves, printed with backslashes (e.g. `"packages\\db\\src\\pg\\client.ts"`), so the guard's POSIX-path filters do not match on Windows.
  - migrate.test: `EPERM: operation not permitted, symlink` (Windows symlink privilege).
  - Neither file is changed by this branch (`git diff --quiet origin/main HEAD -- packages/db/src/r3-guard.test.ts packages/db/src/pg/migrate.test.ts` is clean). Neither failure involves the new files.
  - Files changed by this ticket: `npx vitest run src/migrations-lint.test.ts src/legacy-reference-guard.test.ts` gives 2 files and 12 tests, all passing. The legacy guard also passed against the full local working tree.
- test:db / db:check: not run, because this host has no Postgres or psql. **CI must confirm** `pnpm test:db` (ci.yml:46) and `pnpm db:check` (ci.yml:51), plus `pnpm test` on Linux, where r3-guard and the symlink test are expected to pass. The only change these jobs exercise is in `db-check.sh`: the regex and the first-connection `if ! ver=...` block. `migrate.ts` has only a comment change.
- db-check.sh proofs, run here (the regex and the APP checks run before psql):
  - `postgresql://localhost?@remote/postgres`: refusal, rc=1.
  - `postgresql://u@localhost:5432?x@remote:5432/postgres`: refusal, rc=1.
  - `postgresql://localhost/a@b`: refusal, rc=1.
  - `postgresql://localhost/postgres?sslmode=%64`: refusal, rc=1.
  - `postgresql://u@localhost:1/postgres`: passes the regex, then `db:check: cannot connect (... the URL is not printed)`, rc=1.
  - `DB_CHECK_APP=stoktok_nobody` and `DB_CHECK_APP=dbcheck_canary`: role-name message, rc=1.
  - `bash -n`: OK.

### Acceptance criteria
- [x] AC1 tokeniser: `migrations-lint.test.ts:19-24` builds `NOT_IDENT`, `TAG` and `TOKEN_RE` with `'gu'`; the lookbehind sits before both the E-string and the dollar-tag alternatives. Evidence: test `tokeniser bypass fixtures` passes, including `x$a$`, `$é$`, `éE'\'` and `x$E'\'`. The existing fixtures are unchanged.
- [x] AC2 block-comment ban: `lintMigration` checks for a `/*` token or a leftover `/*` and pushes the result first. Evidence: test `block comment fixtures` covers all 6 cases, including `/* /* */ ' */ commit; -- '` giving `['block comment']` and `select '/*';` giving `[]`.
- [x] AC3 `BASELINE_DO_RE` is exported, module-level and non-global (`:11`). It is used at `:95` (`baseline is plain create`) and in `baseline do-block fixtures`, which also has the negative `select 1;`. No inline copy remains.
- [x] AC4 lint nits: `reset session authorization`, `set_config(E'role'`/`e'role'`/`'session_authorization'` and `stoktok.migrating` are flagged. Evidence: tests `role, schema and owner fixtures` and `migrating guard fixtures`. The baseline still lints clean (`forbidden statements`).
- [x] AC5 README: `db/migrations/README.md:3` is reworded, and the no-block-comments bullet is at `:9`.
- [x] AC6 guard: `legacy-reference-guard.test.ts`. It skips the 5 directories at any depth, symlinks, `.env*` files (except `.env.example`), binary files and files over 1 MB. Offenders are reported as `path:line` only. The baseline is scanned with line 1 removed. Test `no legacy migration paths outside the allowlist` passes. The impl-log records a negative proof, `scripts/db-check.sh:224`.
- [x] AC7 matcher and allowlist fixtures: both tests pass. The fixture strings are built from parts, so the guard can scan its own file.
- [x] AC8 the URL regex refuses an `@` after the authority (`db-check.sh:63`). Proofs are above.
- [x] AC9 nits: reserved `DB_CHECK_APP` names (`:38-40`), the connect error (`:104-108`), and `%` plus system names in the header (`:14-15`) and in `refuse_url` (`:64`). The URL is never echoed.
- [x] AC10 `migrate.ts:187`: one comment line changed, no code change.
- [x] AC11 no release: no change to `apps/`, Dockerfiles or workflows (diff stat vs origin/main).
- [~] AC12: typecheck and lint are green. `test` is green for everything this ticket touches; the remaining failures predate this branch and come from the Windows host. test:db and db:check cannot run on this host and are left to CI (see Checks). **The PR must not be merged unless all five CI jobs are green.**

### Issues
None.

### Rules R1–R10
No violations found. R3: the guard never reads `.env*` files and never prints line content, and db-check.sh never prints `DB_CHECK_URL`. R7: every changed file is in the plan. R8: every lint change has a fixture.

### Nits (do not block)
- `packages/db/src/migrations-lint.test.ts:13` has an accidental whitespace edit, `const UP_RE =/^...`; the space before `/` is missing. ESLint does not flag it, but it is an unrelated cosmetic change.
- `db-check.sh`: on a connect failure without psql, the shell's `psql: command not found` line appears before the new message. This is harmless.
- The guard walks the working tree, so local untracked build artefacts outside the five skipped directories (e.g. `.turbo/`) would be scanned. CI uses a clean checkout, so this is fine there.

### Follow-ups (out of scope)
- `r3-guard.test.ts` and the symlink test in `pg/migrate.test.ts` fail on Windows: the paths are not POSIX-normalised, and symlinks need a privilege. This is a candidate `debt` issue if Windows local dev matters.
- The lint does not flag changes to `standard_conforming_strings` / `backslash_quote` (already listed in impl-log).
