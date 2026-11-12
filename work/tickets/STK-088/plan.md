Status: READY

# Plan — STK-088: Migration-lint tokeniser gaps and legacy-reference guard (STK-086 split)

## Spec summary
Ticket `## Goal` (quoted from the STK-086 plan, "Split proposal"):
> STK-088 scope, in `packages/db/src/migrations-lint.test.ts` and a new `packages/db/src/legacy-reference-guard.test.ts`:
> - **Lint**:
>   - A shared identifier-character lookbehind `(?<![A-Za-z0-9_$\u{80}-\u{10FFFF}])` (with the `u` flag) before both the dollar-tag and the E-string alternatives. This closes `$` inside identifiers, as in `x$a$`, and non-ASCII identifier prefixes.
>   - A non-ASCII dollar-tag class, `[A-Za-z_\u{80}-\u{10FFFF}][A-Za-z0-9_\u{80}-\u{10FFFF}]*`.
>   - A ban on block comments in migrations: any `/*` token or leftover `/*` is flagged as `block comment`. This also closes the nested-comment bypass.
>   - An exported shared `BASELINE_DO_RE` const, used by both `baseline is plain create` and the fixture test.
>   - Fixtures for each item: `select 1 as x$a$; grant select on t to public; -- $a$`; `select $é$ -- $é$; grant select on t to public;`; `/* /* */ ' */ commit; -- '`; `/* x */ select 1;` (flagged); `select '/*';` (not flagged).
>   - Add one line to `db/migrations/README.md`: "no block comments".
> - **Legacy-reference guard:** walk the repo, skipping `node_modules`, `.git`, `.next`, `dist` and `coverage`. Fail if any file outside `supabase/`, `work/`, `docs/`, `.claude/` and `scripts/schema-diff.sh` contains `supabase/migrations` or `supabase/rollback`. The frozen `db/migrations/20261111000200_baseline.sql` (its provenance comment on line 1) is allowlisted by exact path. Reword `db/migrations/README.md:3` to "the old `supabase/` migration history". Add a fixture showing the matcher flags `ls supabase/migrations/*.sql`.

Ticket acceptance criterion 2 (Ming, 2026-11-11):
> `scripts/db-check.sh` URL regex: refuse an `@` after the authority (path/query `(/[^?@]*)?(\?[^@]*)?$`) so `postgresql://localhost?@remote/postgres` is refused; add a refusal proof. Optional nits: refuse `DB_CHECK_APP` = `stoktok_nobody`/`dbcheck_canary` with a clear message; clear error when libpq rejects the URL; mention `%` and system names in the refusal text and header.

Ticket `## Notes / answers from Ming`:
> 2026-11-11: Optional nits for its planner: `reset session authorization`, `set_config(E'role'`.
> 2026-11-12: the migration lint also flags `set_config`/`set` of `stoktok.migrating` in migration files; correct the "cannot forge" comment at packages/db/src/pg/migrate.ts:187 to "catches accidents, not a hostile file".

Release rule (ticket): "no stoktok release is cut until STK-084". CLAUDE.md R7 (stay inside the plan), R8 (green checks, tests for changed logic).

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | `TOKEN_RE` has the `u` flag and one shared lookbehind const `(?<![A-Za-z0-9_$\u{80}-\u{10FFFF}])` in front of both the E-string and the dollar-tag alternatives; the dollar-tag class is `[A-Za-z_\u{80}-\u{10FFFF}][A-Za-z0-9_\u{80}-\u{10FFFF}]*`. | Read `migrations-lint.test.ts`. Test `tokeniser bypass fixtures` passes, including the ticket fixtures `select 1 as x$a$; grant select on t to public; -- $a$` → `['grant']` and `select $é$ -- $é$; grant select on t to public;` → `['grant']`, plus the two E-string prefix fixtures (Tests table). All existing fixtures are unchanged and still pass. |
| 2 | Block comments are banned: any `/*` token, or any `/*` left after removing all tokens, adds `block comment` once. | Test `block comment fixtures`: `/* /* */ ' */ commit; -- '` → `['block comment']`; `/* x */ select 1;` → `['block comment']`; `/* unterminated` → `['block comment']`; `select '/*';` → `[]`; `-- /*` → `[]`; `select 1 as "a/*b";` → `[]`. |
| 3 | `BASELINE_DO_RE` is an exported module-level const (not global), used by both `baseline is plain create` and the do-block fixture test. | `grep -n "BASELINE_DO_RE\|do\\\\s+(language" packages/db/src/migrations-lint.test.ts` shows one definition and two uses, and no inline copy of the regex. Test `baseline do-block fixtures` also has the negative `select 1;`. |
| 4 | Optional lint nits from the ticket notes: `reset session authorization`, `set_config(E'role'` (and `'session_authorization'`), and any reference to `stoktok.migrating`, are flagged. | Test `role, schema and owner fixtures` / `migrating guard fixtures` (Tests table). |
| 5 | `db/migrations/README.md`: line 3 reads "the old `supabase/` migration history"; a "no block comments" line is added to the rules list. | Read the file. |
| 6 | Legacy-reference guard: walks the repo (skipping the five directories at any depth, symlinks, `.env*` files, binaries by extension and files over 1 MB), and fails with `path:line` for any match of the needle outside the allowlist. The baseline is allowlisted by exact path, scanning it with line 1 removed. | Test `legacy-reference-guard.test.ts › no legacy migration paths outside the allowlist` passes on the branch. **Negative proof (scratch, not committed):** add a line `see supabase/migrations` to e.g. `scripts/db-check.sh` → the test fails naming `scripts/db-check.sh:<line>`; revert. Record in `impl-log.md`. |
| 7 | Matcher fixtures: flags `ls supabase/migrations/*.sql` and the Windows form; does not flag `supabase/legacy/...` or the reworded README text. Allowlist fixtures: root-only prefixes, exact paths. | Tests `matcher fixtures` and `allowlist fixtures`. |
| 8 | `scripts/db-check.sh` refuses an `@` after the authority. | Run (no Postgres needed; the regex runs before any psql call): `DB_CHECK_URL='postgresql://localhost?@remote/postgres' bash scripts/db-check.sh; echo $?` and `DB_CHECK_URL='postgresql://u@localhost:5432?x@remote:5432/postgres' bash scripts/db-check.sh; echo $?` → both print the refusal text and `1`. `DB_CHECK_URL='postgresql://u@localhost:1/postgres' bash scripts/db-check.sh` → passes the regex and fails on connect with the new clear error (not the refusal). Commands and output in `impl-log.md`. |
| 9 | db-check.sh nits: `DB_CHECK_APP=stoktok_nobody` and `DB_CHECK_APP=dbcheck_canary` exit 1 with a clear message; a failed first connection prints a clear `db:check:` error without echoing the URL; the refusal text and header mention `%` in the query and the system/reserved names. | `DB_CHECK_APP=stoktok_nobody bash scripts/db-check.sh; echo $?` → message + `1` (same for `dbcheck_canary`). Proof in AC8 covers the connect error. `grep -n 'DB_CHECK_URL' scripts/db-check.sh` shows no `echo`/`printf` of its value. Read the header lines 13-17 and `refuse_url`. |
| 10 | `packages/db/src/pg/migrate.ts:187` comment reworded to say the guard "catches accidents, not a hostile file". Comment-only change. | `git diff main -- packages/db/src/pg/migrate.ts` shows a single comment line changed, no code. |
| 11 | Production keeps working: no release is cut. | `git diff --stat main` touches only the files in the table below (plus `work/`). No release branch, no change to `apps/`, Dockerfiles or workflows. |
| 12 | `typecheck`, `lint`, `test`, `test:db` and `db:check` green. | Run all five; CI on the PR green. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/db/src/migrations-lint.test.ts` | Modify: `NOT_IDENT` lookbehind const, `u` flag, non-ASCII tag class, block-comment ban in `lintMigration`, exported `BASELINE_DO_RE`, new FORBIDDEN entries (reset session authorization, `E'role'`/`session_authorization`, `stoktok.migrating`), honest catch-accidents comment, new fixtures. | AC1-4. |
| `packages/db/src/legacy-reference-guard.test.ts` | Create: repo walk, needle, allowlist, guard test and fixtures. | AC6-7. |
| `db/migrations/README.md` | Modify: reword line 3; add the "no block comments" line. | AC5; also removes a guard hit. |
| `scripts/db-check.sh` | Modify: URL regex groups 5/6, refusal text, header (lines 13-17), `DB_CHECK_APP` reserved names, clear first-connection error. | AC8-9. |
| `packages/db/src/pg/migrate.ts` | Modify **line 187 comment only**. | AC10 (ticket note 2026-11-12). |
| `work/tickets/STK-088/impl-log.md` | Create: implementer log with the db-check.sh and guard negative proofs. | Workflow; AC6, AC8. |

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `migrations-lint.test.ts › tokeniser bypass fixtures` (extend) | Add: `select 1 as x$a$; grant select on t to public; -- $a$` → `['grant']`; `select $é$ -- $é$; grant select on t to public;` → `['grant']`; `select éE'\'; grant select on t to x; -- '` → `['grant']` (non-ASCII prefix stops the E-string; JS source needs `\\`); `select x$E'\'; grant select on t to x; -- '` → `['grant']`; `select $é$ grant $é$;` → `[]` (body hidden as Postgres does). Existing six fixtures unchanged. |
| `migrations-lint.test.ts › block comment fixtures` (new) | The six cases in AC2. |
| `migrations-lint.test.ts › role, schema and owner fixtures` (extend) | `reset session authorization;` → `['set session authorization']`; `select set_config(E'role', 'x', false);` and `select set_config(e'role', 'x', false);` → `['set_config role']`; `select set_config('session_authorization', 'x', false);` → `['set_config role']`. Existing cases unchanged. |
| `migrations-lint.test.ts › migrating guard fixtures` (new) | `set local stoktok.migrating = 'x';` → `['migrating guard']`; `select set_config('stoktok.migrating', 'x', true);` → `['migrating guard']`; `-- stoktok.migrating` → `[]`. |
| `migrations-lint.test.ts › baseline do-block fixtures` (change) | Uses `BASELINE_DO_RE`; existing three positives plus negative `select 1;`. |
| `migrations-lint.test.ts › baseline is plain create` (change) | Uses `BASELINE_DO_RE` instead of the inline regex. |
| `migrations-lint.test.ts › forbidden statements` (unchanged) | Regression: the baseline still lints clean under the new rules (no `/*`, no `stoktok.migrating`, no `x$` identifiers in `db/` — checked by grep at planning time). |
| `legacy-reference-guard.test.ts › no legacy migration paths outside the allowlist` | Repo walk returns `[]` offenders (`path:line` strings). |
| `legacy-reference-guard.test.ts › matcher fixtures` | Flags `ls supabase/migrations/*.sql` and `supabase\rollback\x.down.sql`; does not flag `supabase/legacy/bootstrap-roles.sql` or ``the old `supabase/` migration history``. |
| `legacy-reference-guard.test.ts › allowlist fixtures` | `isAllowed('work/x.md')`, `('docs/a/b.md')`, `('.claude/x')`, `('supabase/x.sql')`, `('scripts/schema-diff.sh')` → true; `('apps/work/x.md')`, `('scripts/db-check.sh')`, `('packages/db/src/legacy-reference-guard.test.ts')` → false; baseline handled by the line-1 rule, not `isAllowed`. |

## Approach
1. **Rebase** `ticket/STK-088` on `main` (STK-087 is merged; it edited the same file). Run `pnpm --filter @stoktok/db test` once before any change to have the baseline green.
2. **Tokeniser** (`migrations-lint.test.ts`):
   - `const NOT_IDENT = String.raw\`(?<![A-Za-z0-9_$\u{80}-\u{10FFFF}])\`;` and a tag class const; build `TOKEN_RE` with `new RegExp(..., 'gu')` (or a literal with `/gu`). Keep the order and the `/*…*/` alternative so comment contents are never scanned as SQL. Keep `TOKEN_RE` global and use it only via `.replace`/`.match` (no `lastIndex` state).
   - First commit of this step: only the `u` flag + lookbehind + tag class, then run the existing fixtures unchanged (regression check from the consult) before adding new ones.
   - Update the header comment: the lint catches accidents, not a hostile file; the real defence is the owner-only role plus the db:check ACL checks (consult "Risks").
3. **Block-comment ban:** in `lintMigration`, push `'block comment'` **first** (before FORBIDDEN results) and once, when any `TOKEN_RE` match starts with `/*` or `/\/\*/` matches `stripLiterals(sql)`. Order is fixed so fixture arrays are deterministic.
4. **FORBIDDEN additions:** change `set session authorization` regex to `/\b(set|reset)\s+(local\s+|session\s+)?session\s+authorization\b/i`; change `set_config role` to `/\bset_config\s*\(\s*[Ee]?'(role|session_authorization)'/i`; add `['migrating guard', /\bstoktok\.migrating\b/i]` (runs on `stripComments` output, so it also catches the quoted forms).
5. **`BASELINE_DO_RE`:** `export const BASELINE_DO_RE = /\bdo\s+(language\s+\w+\s+)?(\$|')/i;` (no `g`). Use it in both tests. Do not import it from the guard test (importing a `.test.ts` re-registers its tests).
6. **README:** line 3 → "...is the squash of the old `supabase/` migration history."; add after line 7 a bullet "- No block comments (`/* */`); use `--`. The lint rejects any `/*`."
7. **Guard test** (`legacy-reference-guard.test.ts`), ROOT = `join(__dirname, '..', '..', '..')`:
   - `NEEDLE = /supabase[\\/]+(migrations|rollback)/` (also catches Windows separators). The regex source does not match itself.
   - Walk with `readdirSync(dir, { withFileTypes: true })`; skip dirs named `node_modules`, `.git`, `.next`, `dist`, `coverage` at any depth; skip symlinks; skip files named `.env` or starting `.env.` except `.env.example` (never load secret files into a test); skip binary extensions (png, jpg, jpeg, gif, webp, ico, woff, woff2, ttf, pdf, zip, gz, tgz) and files over 1 MB.
   - Relative paths normalised to POSIX (`split(sep).join('/')`).
   - `isAllowed(rel)`: true if `rel` starts with `supabase/`, `work/`, `docs/` or `.claude/` (root-relative, so only at the root) or equals `scripts/schema-diff.sh`.
   - Baseline `db/migrations/20261111000200_baseline.sql`: scan with line 1 removed (exact-path rule; tighter than exempting the whole file).
   - Offenders are reported as `path:line` only — **never the line content** (no risk of printing a value from an unexpected file).
   - The guard file itself is scanned (not allowlisted): the fixture is built from parts, e.g. `['ls supabase', 'migrations/*.sql'].join('/')`, and no comment in the file contains the literal needle.
8. **`db-check.sh`:**
   - `url_re='^postgres(ql)?://([^@/?]*@)?(localhost|127\.0\.0\.1)(:[0-9]+)?(/[^?@]*)?(\?[^@]*)?$'`. Group numbers unchanged, so `BASH_REMATCH[3/4/6]` stay.
   - `refuse_url` text: host must be localhost or 127.0.0.1; no `@` after the host; no `%` in the query; no host, hostaddr, port or service parameters. Never print the URL.
   - `case "$APP"`: add `stoktok_nobody|dbcheck_canary)` with "DB_CHECK_APP must not be a db:check role name"; keep the system-name branch; mention both in the header.
   - First connection: `if ! ver="$(su_psql -At -c 'select version()')"; then echo "db:check: cannot connect (libpq rejected DB_CHECK_URL or the server is unreachable; the URL is not printed)" >&2; exit 1; fi; echo "server: $ver"`. Works for both modes (message names DB_CHECK_URL only as a variable name).
   - Header lines 13-17: mention the `@`-after-host and `%` refusals and the reserved `DB_CHECK_APP` names.
9. **`migrate.ts:187`:** comment only, e.g. `// Random per file, so a leftover from an earlier file never matches. This catches accidents, not a hostile file (a file can read and re-set it).`
10. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:db`, `pnpm db:check`; run the AC8/AC9 refusal proofs and the AC6 negative proof; record all in `impl-log.md`.

Rules: R7 — only the files above; `migrate.ts` is a comment-only edit requested by the ticket notes. R8 — all checks green; every lint change has a fixture. R3 — db-check.sh never echoes the URL or password. R1/R2/R4/R5/R6/R9/R10 — not touched (no app, money, market-data or auth code).

Estimated size: about 60 lines in the lint test, 70 in the guard test, 15 in db-check.sh, 3 in docs/comment. One cycle.

## Specialist input used
`consult-database-optimizer.md`:
- Adopted: `NOT_IDENT` const + `u` flag + tag class; regression run of existing fixtures first; block-comment flag via token match plus leftover `/*` test; keep the `/*…*/` alternative; `BASELINE_DO_RE` non-global with a negative fixture; FORBIDDEN additions for `reset session authorization`, `[Ee]?'role'`/`'session_authorization'` and `stoktok.migrating` (open questions 3, first three); `migrate.ts:187` as comment-only; POSIX path normalisation, symlink/size/binary skips, root-only prefix allowlist, baseline minus line 1 (open question 2); needle with `[\\/]+`; negative matcher fixture; db-check.sh regex, refusal proofs in `impl-log.md` only (open question 4), reserved `DB_CHECK_APP` names, connect error, no URL echo; honest catch-accidents comments.
- Adapted: open question 1 (self-allowlist the guard test) — instead the fixture is built from parts so the guard also scans itself and the allowlist stays exactly as the ticket states.
- Added (not in consult): skip `.env*` (except `.env.example`) and report `path:line` only, to keep the walk from loading or printing secret values (workspace secrets rules).
- Rejected: flagging `standard_conforming_strings` / `backslash_quote` and backslash-led lines — not in the ticket scope (R7). The implementer lists them as a follow-up in `impl-log.md` for a `debt` issue.
- Ordering: `export BASELINE_DO_RE` is kept (the ticket says "exported"); the consult's "export only if needed" is overridden by the ticket text.

## Assumptions
- STK-086 and STK-087 are merged to `main` (recent commits confirm STK-087 PR #65); the branch is rebased before work.
- `pnpm test` runs `packages/db` `src/**/*.test.ts` (confirmed in `packages/db/vitest.config.ts`), so the guard runs in CI without config changes; `test:db` (`test-db/**`) is unaffected.
- `.github/**` and root dotfiles contain no needle today (grep at planning time); the guard covers them because the walk does not skip hidden files other than `.git`.
- `test-db/migrate.test.ts` mentions `stoktok.migrating`; the lint only scans `db/migrations`, so that is fine.
- libpq's own stderr on a bad URL is left as is (existing behaviour); the script itself never prints the URL.
- `'block comment'` is reported first in the result array; exact fixture arrays depend on this order.

## Blocking questions
None.

## Split proposal
None.
