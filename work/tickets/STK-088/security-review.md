# Security review — STK-088

## Attempt 1 — 2026-11-12

**Verdict: no 🔴 and no 🟡 that needs a REWORK.** The diff does what the ticket and plan ask, and the `localhost?@remote` bypass is closed. Everything below is a follow-up or a nit.

I had no shell, so I read the files on the working tree and ran nothing. I did not see `git diff`, and the line numbers are from the current files. Postgres and libpq behaviour is reasoned from the PG17 lexer and libpq URI rules, not tested. `test:db` and `db:check` were not run locally either (impl-log lines 19-23), so CI is the only proof that they pass.

### Findings

**scripts/db-check.sh**
- 🟢 **`:63` closes the bypass.** The regex is `^postgres(ql)?://([^@/?]*@)?(localhost|127\.0\.0\.1)(:[0-9]+)?(/[^?@]*)?(\?[^@]*)?$`.
  - libpq ends userinfo at the first `@` or `/`. The regex's userinfo already excludes `@`, `/` and `?`, and nothing after the host may contain `@`. So the only `@` libpq can split on is the one before `localhost`/`127.0.0.1`.
  - Multi-host (`localhost,remote`), a `,` after the port, an uppercase scheme and keyword conninfo all still fail the full-string match.
  - The refusal at `:64` is fixed text and never echoes the URL.
  - The proofs in `impl-log.md:26-29` (two bypass URLs refused, plus the reserved `DB_CHECK_APP` names) meet the plan (plan step 10).
- 🟢 **`:37-44` is correct.** `DB_CHECK_APP` is checked against `^[a-z][a-z0-9_]*$` first, so the later SQL that inserts `$APP` (`:153-154`, `:164`, canaries) cannot be injected.
- 🟢 **`:104-107`, nit: psql's own error can print part of the URL.** The db-check message prints no URL, but psql's stderr is not captured. For a malformed percent-escape in the password, libpq's error quotes the decoded component, e.g. `invalid percent-encoded token: "<password>"`. This only shows on the developer's own terminal or in CI, where the password is the public `postgres`. Two options:
  - Add `2>/dev/null` to this first probe only; the fixed message already says what went wrong.
  - Or change the comment so it says only the script's own message omits the URL.
- 🟢 **`:69`, nit: `?dbname=` is not refused in the query.** It is not a host bypass: only the first `dbname` is expanded, and the regex already refused any `@`. But a `dbname` in the query overrides the path, so `su_app` (`:71-73`) would connect to that database instead of `$APP`. That gives wrong-database checks on localhost, not an escape. A fail-closed fix is to add `dbname` to the grep list: `(host|hostaddr|port|service|dbname)`.

**packages/db/src/migrations-lint.test.ts**
- 🟢 **`:19-24`, tokeniser.**
  - `NOT_IDENT` matches PG's `ident_cont` (`[A-Za-z0-9_$\200-\377]`).
  - `TAG` matches PG's `dolq_start`/`dolq_cont`.
  - The `u` flag is set, which `\u{...}` and the lookbehind need.
  - The fixtures at `:119-123` cover `x$a$`, `$é$`, `éE'`, `x$E'` and the negative case.
  - Remaining differences: a dollar quote right after a digit (`1$a$`), after `$1`, or right after another dollar quote. In all of them the lint sees more code than Postgres does, never less, and Postgres rejects the input with a syntax error. So they are not usable bypasses.
- 🟢 **`:64`, block-comment ban.** It flags both a matched `/*...*/` token and any `/*` left over after `stripLiterals`. That also covers unterminated comments and `/*` inside an operator (PG ends operators at `/*`). Since the ban covers every `/*`, the nested-comment problem is gone. The fixtures at `:127-132` include the false-positive guards (`'/*'`, `"a/*b"`, `-- /*`).
- 🟢 **`:49-51`.** `set_config(E'role'`, `reset session authorization` and `stoktok.migrating` are now flagged. The search runs on `stripComments` output, which keeps strings, so `'stoktok.migrating'` inside `set_config(...)` is caught (`:136-138`).
- 🟡 (follow-up, already in `impl-log.md:37`) **`standard_conforming_strings` / `backslash_quote` are not linted.** One detail makes this worse than "this file only".
  - The runner reuses one session for all files (`migrate.ts:183-206`).
  - So a plain `set standard_conforming_strings = off` in file N, once committed, stays in effect while Postgres lexes file N+1.
  - The lint assumes it is `on`. Under `off`, a file shaped like `select 'x\' ; ' ; grant ... ; -- '` hides the `grant` from the lint while Postgres runs it.
  - What actually stops harm is the owner-only role plus the ACL checks, as the file's own comment says (`:18`), so this is not a REWORK.
  - **Fix (one line, new ticket or debt issue):** add `['string settings', /\b(standard_conforming_strings|backslash_quote)\b/i]` to `FORBIDDEN`.
- 🟢 **`:11`.** `BASELINE_DO_RE` is exported and used at both `:95` and `:155-156`, as the scope asks.

**packages/db/src/legacy-reference-guard.test.ts**
- 🟢 **`:27`, secrets handling is acceptable.** `.env` and `.env.*` (except `.env.example`) are skipped, and failures print `path:line` only (`:34`, `:44`), never the line content.
  - Nit: `.envrc` and files like `*.pem` are still read into memory. Nothing from them is printed, but `/^\.env/` (keeping the `.env.example` exception) would also match `.envrc`.
- 🟡 (follow-up, matches the scope as written) **`:12`: `NEEDLE` only matches a literal `supabase/migrations` (or `\`).** In TS code, the likelier future reference is `join(ROOT, 'supabase', 'migrations')`, and the guard misses it. That is the same style `migrations-lint.test.ts:6` uses for `db/migrations`.
  - Today nothing in the repo has that form: I searched for `'supabase'\s*,\s*'(migrations|rollback)'` outside node_modules, and the only hit is the guard's own fixture, which is allowlisted.
  - Suggested follow-up: add a second needle, `/['"]supabase['"]\s*,\s*['"](migrations|rollback)['"]/`, with a fixture.
- 🟢 **`:9`, `:43`.** The baseline is allowlisted by exact path and line 1 only, as the scope asks. `:16` allowlists exactly the scoped prefixes plus `scripts/schema-diff.sh`, and the fixtures at `:63-64` include negatives (`apps/work/x.md`, `scripts/db-check.sh`).

**packages/db/src/pg/migrate.ts**
- 🟢 **`:187`.** This is a comment-only change and it is now accurate ("catches accidents, not a hostile file"). The runner still never prints the URL (`:128-132`, `:144`).

**db/migrations/README.md**
- 🟢 **`:3` and `:8`** match the scope wording, and `:3` no longer trips the guard.

### Recommendations
1. Open a `debt` issue for the `standard_conforming_strings`/`backslash_quote` lint entry. It should note that the setting carries over between files in one runner session. (R7: not in this ticket's plan.)
2. Open a `debt` issue for the `join('supabase','migrations')` needle in the legacy guard. (R7.)
3. Optional: a vitest that runs `bash scripts/db-check.sh` with `DB_CHECK_URL='postgresql://localhost?@remote/postgres'` and expects exit 1 plus the refusal text. The refusal happens before any psql call, so it needs no Postgres. This turns the manual proof in the impl-log into a regression test.
4. Optional nits for `db-check.sh`: add `dbname` to the refused query keys (`:69`), and either add `2>/dev/null` to the first psql probe or reword the comment (`:104-105`).

### Risks
- `test:db` and `db:check` have not run against Postgres on this branch (local Windows run, impl-log `:23`). AC4 depends on CI being green, and R8 forbids a PASS without it.
- The lint is a heuristic for accidents. A deliberately hostile migration can still get past it (for example by building strings with `'stoktok.' || 'migrating'`, or with `set "role"`). The real security boundary is the owner-only role plus `checks-acl.sql`.

### Open questions
- None blocking. The PG17/libpq behaviour I relied on (userinfo split at the first `@` or `/`, only the first `dbname` expanded, a session-level SET carrying over between simple-query calls) is from reading the code, not from running it.
