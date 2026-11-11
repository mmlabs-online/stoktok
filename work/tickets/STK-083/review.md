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
