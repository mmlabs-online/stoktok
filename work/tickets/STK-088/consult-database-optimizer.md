**STK-088 consult (database-optimizer, read-only). Nothing was edited and no commands were run.**

## Findings

1. **Current tokeniser** (`packages/db/src/migrations-lint.test.ts:15-16`)
   - `TOKEN_RE` has no `u` flag and no shared lookbehind. Only the E-string alternative has `(?<![A-Za-z0-9_])`; the dollar-tag alternative has none.
   - The tag class is ASCII only.
   - `FORBIDDEN` tests run on `stripComments()` output, so strings are still scanned. Only the transaction-control check uses `stripLiterals()`.
   - The `set role`, `set_config role` and `set session authorization` regexes do not cover `reset session authorization` or `set_config(E'role'`.

2. **Block comments.**
   - There is no `/*` anywhere under `db/` (grep), so a total ban cannot break the baseline.
   - Postgres lexes `/*` as a comment start even inside operator characters, so a ban has no false positives outside literals.
   - The ban is sound for a structural reason. The tokeniser is correct up to the first `/*` outside a string or line comment. Any file with such a `/*` is rejected whatever the tokeniser does after it. This is why the ban also closes the nested-comment bypass without implementing nesting.

3. **STK-087 follow-up not yet done.**
   - `FORBIDDEN` has no `stoktok.migrating` entry. The ticket notes ask for one.
   - The "cannot forge" comment is at `packages/db/src/pg/migrate.ts:187`. It needs rewording to "catches accidents, not a hostile file".

4. **Legacy-reference guard: what matches today.**
   - A grep outside `work/`, `docs/`, `.claude/` and `supabase/` finds three files:
     - `db/migrations/README.md:3`, to be reworded.
     - `db/migrations/20261111000200_baseline.sql:1`, the allowlisted provenance comment.
     - `scripts/schema-diff.sh`, allowlisted.
   - Ripgrep skips hidden files by default, so `.github/**` and dotfiles were not reliably covered. The implementer should confirm the guard passes there, for example on `risk-tiers.yml` paths.
   - The new guard test will itself contain the needle strings (the fixture `ls supabase/migrations/*.sql` and the needle constants). It needs a self-allowlist.

5. **`db-check.sh` bypass is real.**
   - STK-086 security review line 136-140 shows that libpq scans for userinfo up to the first `@` or `/`, not `?`. So `postgresql://localhost?@remote/postgres` reads `localhost?` as the user and `remote` as the host.
   - The current regex at `scripts/db-check.sh:59` ends `(/[^?]*)?(\?.*)?$`, which accepts it.

## Recommendations

**Lint (AC1)**

- **Lookbehind and `u` flag.**
  - Define `const NOT_IDENT = String.raw`(?<![A-Za-z0-9_$\u{80}-\u{10FFFF}])``. Put it before both the E-string and the dollar-tag alternatives, and add the `u` flag to `TOKEN_RE`.
  - Under `u`, `\/`, `\$` and `\\[\s\S]` stay valid and the `\1` backreference still works.
  - Keep the dollar tag as `\$([A-Za-z_\u{80}-\u{10FFFF}][A-Za-z0-9_\u{80}-\u{10FFFF}]*)?\$`.
  - Postgres treats `\200-\377` as identifier characters and `$` as an identifier continuation, so this matches the server.
  - Keep `TOKEN_RE` global and use it only with `.replace`, so there is no `lastIndex` state.
  - `BASELINE_DO_RE` must not be global, for the same reason.

- **Fixture traces (hand-traced, not run).**
  - `select 1 as x$a$; grant select on t to public; -- $a$`: both `$` positions are preceded by an identifier character, so no tag matches. The `--` comment then eats the tail, giving `['grant']`.
  - `select $é$ -- $é$; grant select on t to public;`: the tag matches, the dollar body is consumed up to the second `$é$`, and the remaining `grant` is flagged.

- **Block-comment ban.**
  - Run the tokeniser once through a `replace` callback. Set a flag when `m.startsWith('/*')`.
  - After replacing all tokens with a space, also test `/\/\*/` on the remainder, which catches an unterminated `/*`.
  - Push `'block comment'` once.
  - Expected results:
    - `/* /* */ ' */ commit; -- '` gives `['block comment']`. The old tokeniser hid the `commit`.
    - `/* x */ select 1;` gives `['block comment']`.
    - `select '/*';` gives `[]`.
    - `-- /*` gives `[]`.
  - Keep the `/*…*/` alternative in `TOKEN_RE`, so a comment's contents are not scanned as SQL.
  - Order does not matter, because the leftmost match wins.

- **`BASELINE_DO_RE`.** Define it as a module-level const in the same file and use it in both `baseline is plain create` and the fixture test.
  - Do not import it from `migrations-lint.test.ts` into the guard test. Importing a `.test.ts` file re-registers its tests. Export it only if something truly needs it.
  - Add one negative fixture: `select 1;` does not match.

- **Optional nits, cheap and in the same regex table.**
  - `reset\s+session\s+authorization`.
  - `set_config\s*\(\s*[Ee]?'role'`, and also `'session_authorization'`.
  - Add `/\bstoktok\.migrating\b/i` as `['migrating guard', …]`. It covers `set`, `set_config` and the quoted form, because the substring still appears inside the quotes.
  - Add a fixture for each.
  - Reword the comment at `migrate.ts:187`. This touches `packages/db/src/pg/migrate.ts`, so it is in scope only as a comment-only change. Say so in the plan.

- **README.** Add one line to `db/migrations/README.md` line 7: "no block comments". Reword line 3 to "the old `supabase/` migration history".

**Guard (AC1)**

- **Normalise paths.** Make them POSIX (`split(sep).join('/')`), because Ming also runs on Windows.
- **Skip set.** Skip these at any depth: `node_modules`, `.git`, `.next`, `dist`, `coverage`. Do not follow symlinks (`Dirent.isSymbolicLink()`). Skip files over about 1 MB, and binary files by extension, to keep the walk fast.
- **Allowlist.**
  - The four top-level directories match by prefix only at the repo root (`supabase/`, `work/`, `docs/`, `.claude/`).
  - Exact paths: `scripts/schema-diff.sh`, `db/migrations/20261111000200_baseline.sql`, and the guard test itself.
  - Tighter for the baseline: scan its content with line 1 removed, instead of exempting the whole file. The file is checksum-frozen, so line 1 is the only legitimate hit.
- **Needle.** Use `/supabase[\\/]+(migrations|rollback)/`. This also catches Windows separators.
- **Fixture.** The matcher must flag `ls supabase/migrations/*.sql`. Add a negative fixture such as `supabase/legacy/x`.

**`db-check.sh` (AC2)**

- Change the path and query groups to `(/[^?@]*)?(\?[^@]*)?$`. Take `BASH_REMATCH` indexes from the unchanged groups. Group numbering does not change, because only the contents of groups 5 and 6 change.
- Refusal proofs: `postgresql://localhost?@remote/postgres` and `postgresql://u@localhost:5432?x@remote:5432/postgres` must exit 1 with the refusal text. A plain `postgresql://u@localhost:5432/postgres` must still pass the regex.
- Put the proof wherever STK-086 put its other refusal proofs, and record the commands in `impl-log.md`.
- Nits:
  - Refuse `DB_CHECK_APP` equal to `stoktok_nobody` or `dbcheck_canary` with a clear message.
  - Wrap the first psql call so a libpq URL error prints "libpq rejected DB_CHECK_URL".
  - Mention `%` and system names in the refusal text and the header.
  - Do not echo the URL, which may contain a password.

## Risks

- The lint is a catch-accidents tool, not a sandbox.
  - Remaining hostile-file bypasses: `set standard_conforming_strings = off` (makes `'\''` hide a quote), psql meta-commands in db:check (`\!`, `\gexec`), and string-built `set_config('ro'||'le'…)`.
  - Optional cheap flags: `standard_conforming_strings`, `backslash_quote`, and any line starting with a backslash.
  - Say in the plan that the real defence is the owner-only role plus the db:check ACL checks. Make the comments honest about this.
- Adding the `u` flag changes how every escape in `TOKEN_RE` is parsed. Run the full existing fixture set unchanged first, as a regression check.
- The guard may be slow or noisy if it reads binaries or `pnpm-lock.yaml`. The size and extension skips handle this.
- Self-reference: the guard fails on its own fixtures unless it is self-allowlisted. Alternatively, build the fixture string from parts.
- STK-084 depends on STK-088, and STK-087 edits the same file. Serialise them, and rebase before starting.

## Open questions (with proposed defaults)

1. Allowlist `packages/db/src/legacy-reference-guard.test.ts` by exact path, even though the ticket's allowlist does not list it? Default: yes, and note it in the plan.
2. Scan the baseline minus line 1 instead of exempting the whole file? Default: yes.
3. Include the optional lint flags (`reset session authorization`, `E'role'`, `stoktok.migrating`, `standard_conforming_strings`)? Default: the first three yes, `standard_conforming_strings` yes (one regex); meta-command flagging no (it is not applied through the runner).
4. Where do the `db-check.sh` refusal proofs live: an inline script in `impl-log.md`, or a new check script? Default: `impl-log.md` evidence only, no new test harness (R7).

Files: `packages/db/src/migrations-lint.test.ts`, `scripts/db-check.sh`, `db/migrations/README.md`, `packages/db/src/pg/migrate.ts` (line 187 comment only).
