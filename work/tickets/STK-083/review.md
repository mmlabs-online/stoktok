## Attempt 1 — 2026-11-11
Verdict: PASS

Reviewed commit `448b6b9` against `origin/main` (`4c78382`). This is slice 1 only: the baseline and the faithfulness proof. The db:check rewrite (STK-086) and the migrate runner (STK-087) are out of scope here.

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0.
- lint: `pnpm lint` exit 0.
- test: `pnpm test` exit 0. core 834, sources 35, ai 184, db 112 (21 files, including `migrations-lint.test.ts`), worker 299, web 352. This matches impl-log.
- build: `pnpm build` exit 0.
- test:db: `DB_TEST_URL=postgresql://postgres@127.0.0.1:54411/postgres pnpm test:db` on a throwaway PG 16.15 cluster (TCP, trust auth). 23 files and 125 tests passed. This matches impl-log.
- db:check: `pnpm db:check` (throwaway cluster) printed `db:check OK`. URL mode (`DB_CHECK_URL` on the same TCP server, as in CI) also printed `db:check OK`. db:check still applies the legacy chain, as the plan intends.
- schema-diff: `SCHEMA_DIFF_OUT=<scratch> bash scripts/schema-diff.sh` exit 0, with:
  - server and pg_dump both 16.15;
  - owner flags `f|f|f|f|f`;
  - `0|0|0` after the rollback;
  - `A' vs B: identical`.
  The A vs B diff has 4 hunks, all on `ai_keys`:
  - the `ai_key_delete`/`ai_key_secrets`/`ai_key_set` functions;
  - the column set and the 4 new checks;
  - the table comment;
  - `ai_keys_secret_id_key`.
  My A vs B diff equals the one recorded in `schema-diff.md`, line for line (ignoring the `---`/`+++` file headers).
- format: the repo has no `format:check` script.

### Acceptance criteria
- [x] 1. The baseline and its rollback exist, and `supabase/` is unchanged. Evidence: `git diff --stat origin/main...HEAD -- supabase/migrations supabase/rollback` is empty, and `migrations-lint.test.ts › file names and parity` passes.
- [x] 2. No Supabase roles, Vault, RLS, grants, extensions, definer functions, drop, `if not exists` or `or replace`. The only privilege statements are the 2 revokes. Evidence:
  - the lint tests `forbidden statements` and `baseline is plain create` pass;
  - `baseline.test.ts › single-owner shape` passes;
  - I read the baseline in full and found no grant, role, RLS, Vault or extension statement.
- [x] 3. No PUBLIC EXECUTE on the `ai_*` functions. Evidence: `baseline.test.ts › functions have no PUBLIC execute` passes. It uses `aclexplode(coalesce(proacl, acldefault(...)))`, and its non-vacuous guard holds.
- [x] 4. `ai_keys` keeps the STK-082 shape and checks. Evidence:
  - `baseline.test.ts › ai_keys keeps the STK-082 shape` covers every boundary in the plan;
  - `ai-keys.test.ts` passes on the baseline template;
  - the dump diff shows the checks `ai_keys_{auth_tag,ciphertext,iv,key_version,last4,provider}_check` are present with the STK-082 bounds.
- [x] 5. A′ = B: `schema-diff.sh` prints `A' vs B: identical` (my own run). Because pg_dump writes columns in attnum order with named constraints, this also proves that column order and constraint names are kept. The two `alter table … add` statements on `symbols` and `data_gaps` are kept as separate statements, as the plan requires.
- [x] 6. A vs B contains only `ai_keys` differences. Each hunk is labelled intentional in `schema-diff.md`. The `secret_id` unique constraint hunk is part of the `secret_id` column change.
- [x] 7. Non-superuser owner, rollback leaves nothing, re-apply works. Evidence:
  - owner flags `f|f|f|f|f`;
  - `0|0|0` after the down file;
  - B is dumped after the re-apply, and the script exits non-zero otherwise.
- [x] 8. Re-apply fails with 42P07 and changes nothing. Evidence: `baseline.test.ts › re-apply fails with 42P07 and changes nothing` passes.
- [x] 9. The test:db template is built from `db/migrations` only. Evidence: `global-setup.ts:77-87`. `grep -n "supabase\|bootstrap" packages/db/test-db/*.ts` finds nothing.
- [x] 10. CI uses Postgres 17. Evidence: `.github/workflows/ci.yml:25` is `image: postgres:17`. CI on the PR is still to be confirmed once the PR is open.
- [x] 11. Production is untouched. Evidence: `git diff --stat origin/main...HEAD` shows nothing under `apps/`, Dockerfiles, `release.yml`, `scripts/db-check*` or `scripts/check-*.sh`.
- [x] 12. typecheck, lint, test, test:db and db:check are all green (above).

### Extra normalisation in `schema-diff.sh` (impl-log deviation)
Verdict: acceptable, and it cannot hide a real difference.

What the normalisation removes, tested on a raw dump of A′:
- exactly 18 `-- Name: …; Type: ROW SECURITY` headers;
- the 18 `ENABLE ROW LEVEL SECURITY` lines;
- the `Dumped from/by` lines;
- the `\restrict` and `\unrestrict` lines.

Nothing else differs between the raw and the normalised dump.

Why it is safe:
- The `sed -z` pattern only matches when the header is followed directly by `--\n\n\n`, that is, when the section is already empty because its `ENABLE` line was deleted.
- A `FORCE ROW LEVEL SECURITY` line, a policy (`Type: POLICY` is its own TOC entry) or any other statement would leave a non-empty body. The header would then stay and the diff would show it. The raw A′ dump has no POLICY or FORCE entries.
- The only blind spot is RLS being enabled on B, and the plan intends that to be invisible here. It is covered elsewhere: `baseline.test.ts` asserts no `relrowsecurity`/`relforcerowsecurity`, and the lint forbids `row level security`.
- Privileges are hidden by `--no-privileges` (as planned). They are covered by the ACL test.

### Issues
None.

### Rules R1–R10
No violations found.
- R2: column types are identical (A′ = B).
- R3: `schema-diff.sh` uses a unix socket with trust auth and reads no URL or secret.
- R7: every changed code file is in the plan's file list. The `work/` files (backlog, the STK-084 note, the STK-086 and STK-087 tickets) are orchestrator bookkeeping for the split.
- R8: all checks are green, with new lint and real-DB tests.

### Nits (do not block)
- `schema-diff.md` "Script output" leaves out the `server:`/`pg_dump:` lines, but the "Versions" line states them.
- `baseline.test.ts › ai_keys keeps the STK-082 shape`: the rejected inserts reuse provider `anthropic`, which already exists. The expected 23514/23502 codes depend on Postgres checking CHECK/NOT NULL before the unique index. That order is deterministic, but the test would read more clearly with a delete between cases or a fresh provider.
- `lintMigration`/`stripComments` are exported from a test file. impl-log already lists this as a possible STK-087 move.

### Follow-ups (out of scope)
- Add a `format:check` script, or state in CLAUDE.md and the agent docs that the repo has none (impl-log follow-up).
- STK-086: as plan A2 notes, no schema-changing ticket should merge before STK-086, because db:check still validates the legacy chain.

## Attempt 2 — 2026-11-11
Verdict: PASS

Reviewed commit `10c92cf`. The diff since review attempt 1 (`1486088..10c92cf`) touches three code files: `packages/db/src/migrations-lint.test.ts`, `packages/db/test-db/baseline.test.ts` and `scripts/schema-diff.sh`. The only other changes are bookkeeping: the attempt counter in `work/backlog.md` and `ticket.md`, plus `impl-log.md`. These are exactly the fixes Ming asked for in ticket.md ("2026-11-11 (Ming, after review attempt 1 PASS)").

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0.
- lint: `pnpm lint` exit 0.
- test: `pnpm test` exit 0. core 834, sources 35, ai 184, db 115 (21 files; +3 lint fixture tests), worker 299, web 352. This matches impl-log.
- build: `pnpm build` exit 0.
- test:db: `DB_TEST_URL=postgresql://postgres@127.0.0.1:54421/postgres pnpm test:db` on a throwaway PG 16.15 cluster (TCP, trust auth). 23 files and 127 tests passed. This matches impl-log.
- db:check: `pnpm db:check` printed `db:check OK`. URL mode (`DB_CHECK_URL` on the same TCP server) also printed `db:check OK`.
- schema-diff: `bash scripts/schema-diff.sh` exit 0. Owner flags `f|f|f|f|f`, rollback `0|0|0`, `A' vs B: identical`.
- format: the repo has no `format:check` script.

### Ming's fixes, verified
1. **Tokeniser** (`migrations-lint.test.ts:15-16`). The token regex now covers:
   - E-strings with `\\`-escapes. A lookbehind stops `typeE'…'` from being read as an E-string.
   - Double-quoted identifiers with `""`.
   - Dollar tags `[A-Za-z_][A-Za-z0-9_]*`, plus the empty tag.

   Fixtures at :102-109 cover each case, both through `grant` (FORBIDDEN) and through `commit` (the TX check). The `"x;commit"` fixture checks that the quoted-identifier alternative does not cause false positives. All pass.
2. **Role switching** (:40-42). The pattern now catches:
   - `SET [LOCAL|SESSION] ROLE` and `RESET ROLE`;
   - `set_config('role'`;
   - `SET [LOCAL|SESSION] SESSION AUTHORIZATION`.

   Fixtures at :111-114 pass.
3. **`create schema` and `owner to`** (:34-35) are banned, with fixtures at :115-116. A fixture at :117 checks that the column names `role` and `owner_id` don't false-positive.
4. **Baseline `do` rule** (:85) is now `/\bdo\s+(language\s+\w+\s+)?(\$|')/i`. Fixtures at :120-123 cover `do $$`, `do language plpgsql $$` and `do '…'`. The real baseline still passes.
5. **Relation ACL check** (`baseline.test.ts:49-53`). It explodes `relacl` for relkinds r/p/v/m/f/S, using `acldefault('s'|'r')` when the ACL is NULL. A non-vacuous guard (row count ≥ number of tables) makes sure the check really sees rows. It then asserts grantee 0 is absent.
6. **Schema ACL and extra schemas** (`baseline.test.ts:55-60`). On `nspacl` (with `acldefault('n')` for NULL), PUBLIC may have only USAGE. It also asserts no schema exists besides `public`, `information_schema` and `pg_*`. The LIKE escape `pg\_%` is correct.
7. **`schema-diff.sh:45`** is now `-k '$TMP'`. I re-ran the script with `TMPDIR` containing a space (`…/sp ace`). It exited 0, printed `A' vs B: identical` and `0|0|0`, and cleaned up its temp dir.

### ACL fail-proof (re-run by reviewer, on a scratch copy of the repo; the working tree was never edited)
| Appended to the baseline | Result |
|---|---|
| `grant select on public.settings to public;` | full `test:db`: **1 failed / 126 passed**, `FAIL baseline > relations have no PUBLIC privileges`, `expected [ 'settings' ] to deeply equal []` |
| `grant create on schema public to public;` | `baseline.test.ts`: `FAIL … schema public gives PUBLIC at most USAGE; no extra schemas`, `expected [ 'CREATE' ]` |
| `create schema other;` | same test fails, `expected [ 'other' ]` |
| `grant usage on all sequences in schema public to public;` | `relations have no PUBLIC privileges` fails, `[ 'transactions_seq_seq', …(5) ]`. This proves the `'S'` → `acldefault('s')` branch. |
| (baseline restored) | `baseline.test.ts` 6/6 passed |

I deleted the scratch copy and the cluster afterwards. `git status` is clean.

### Acceptance criteria
Attempt 1's 12 criteria still hold. The baseline, the rollback, `global-setup.ts`, `ci.yml` and `supabase/` are unchanged since attempt 1, and the re-run checks are green. Ming's added items are verified above (fixes 1-7) and each has its own fixture or test.

### Issues
None.

### Rules R1–R10
No violations found.
- R7: only the three listed files changed, plus bookkeeping.
- R8: all checks are green, and the changed lint logic has fixtures.
- R3: `schema-diff.sh` still reads no URL or secret.

### Nits (do not block)
The lint still has two gaps of the same kind as the ones fixed. I confirmed both against real Postgres 16. They are outside Ming's fix list, and the lint remains a guardrail, not a boundary.
- **Non-ASCII dollar tags.** `select $é$ -- $é$; grant select on t to public;` lints as `[]`, yet Postgres runs the `grant`. Postgres allows non-ASCII letters in tags, while `TOKEN_RE` allows only `[A-Za-z_]`. The new catalog check catches this when the grant is to PUBLIC, but not when it is to another existing role. Possible fix: tag class `[^\W\d]\w*` with the `u` flag, or `[A-Za-z_\x80-￿][A-Za-z0-9_\x80-￿]*`.
- **Nested block comments.** `/* /* */ ' */ commit; -- '` lints as `[]`. Postgres nests `/* */`, so it runs the `commit`. The linter ends the comment at the first `*/`, and the following `'` then swallows the `commit`. FORBIDDEN words are not affected, because `stripComments` keeps strings. Only the TX check is.
- `reset session authorization` and `set_config(E'role', …)` are not flagged. Both are harmless for a role that is a member of no other role.

### Follow-ups (out of scope)
- A stronger catalog gate: assert that every ACL entry on public-schema relations, functions and the schema has a grantee that is either the owner or PUBLIC with USAGE on the schema only. That would catch grants to *any* role, not just PUBLIC, so lint gaps like the ones above stop mattering. Could fit in STK-086.
- Still open from security-review attempt 1:
  - run the `test:db`/`db:check` migrations as a non-superuser owner (STK-086);
  - `revoke connect on database stoktok from public` in the deployment repo's `add-app-db.sh` (raise with Ming).
- Move `lintMigration` out of the test file (STK-087), as noted in attempt 1.
