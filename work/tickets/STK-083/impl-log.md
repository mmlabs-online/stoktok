## Attempt 1 — 2026-11-11

Slice 1 only (baseline and faithfulness proof). Not committed, per the orchestrator's instruction.

### Files touched
| File | Required because |
|---|---|
| `db/migrations/20261111000200_baseline.sql` | Squashed baseline (criteria 1, 2, 4). Generated mechanically from the legacy files with a throwaway script: RLS, grants, Vault and the `ai_keys` guard stripped, final `ai_reserve` body, two `revoke execute ... from public`. |
| `db/rollback/20261111000200_baseline.down.sql` | Rollback (criterion 7). |
| `db/migrations/README.md` | Rules for future migrations (plan step 2). |
| `.gitattributes` | Stable LF checksums for the STK-087 runner. |
| `packages/db/src/migrations-lint.test.ts` | Static lint (criteria 1, 2, 4). |
| `packages/db/test-db/baseline.test.ts` | Real-Postgres shape checks (criteria 2, 3, 4, 8). |
| `packages/db/test-db/global-setup.ts` | Template built from `db/migrations` only; no bootstrap, no `supabase/` (criterion 9). |
| `packages/db/test-db/ai-keys.test.ts` | Removed the legacy-file migration-guard block and its now-unused imports; header comment updated. |
| `packages/db/src/pg/schema.ts` | Header comment only. |
| `.github/workflows/ci.yml` | `postgres:16` to `postgres:17` (criterion 10). |
| `scripts/schema-diff.sh` | Faithfulness proof (criteria 5, 6, 7). |
| `work/tickets/STK-083/schema-diff.md` | Recorded output of the script. |
| `supabase/README.md` | Frozen-reference banner. |
| `docs/adr/0010-self-hosted-postgres-data-layer.md` | Decision 9, slice order and `schema.ts` consequence updated. |

### Tests added / changed
- `packages/db/src/migrations-lint.test.ts` › file names and parity; forbidden statements; baseline is plain create; lint helpers catch their fixtures.
- `packages/db/test-db/baseline.test.ts` › single-owner shape; functions have no PUBLIC execute; ai_keys keeps the STK-082 shape; re-apply fails with 42P07 and changes nothing.
- `packages/db/test-db/ai-keys.test.ts`: migration-guard describe block deleted.

### Checks (actual output summary)
- typecheck: exit 0 (all packages).
- lint: exit 0 (all packages).
- test: core 834, sources 35, ai 184, db 112 (21 files), worker 299, web 352 passed.
- test:db: local PG 16.15 on 127.0.0.1:54399 (trust, throwaway cluster): 23 files, 125 tests passed.
- db:check: `db:check OK` (still the legacy chain, unchanged).
- build: exit 0.
- schema-diff: exit 0, `A' vs B: identical`; rollback leaves `0|0|0`; owner flags all false; A vs B contains only the ai_keys hunks (see `schema-diff.md`).
- format: the repo has no `format` script, so none was run.

### Out-of-plan files
None.

### Deviations and notes
- `schema-diff.sh` normalisation also deletes the `-- Name: ...; Type: ROW SECURITY` section headers. pg_dump leaves those comment-only blocks after the `ENABLE ROW LEVEL SECURITY` lines are removed, so without this A' vs B was not empty. This is only a comment header, not a schema difference.
- `global-setup.ts` and `migrations-lint.test.ts` select migration files by `.sql` suffix (and the lint excludes `README.md` by name); any other name in `db/migrations` fails.
- Local PG data dirs (mktemp under `/tmp`) were stopped and deleted.

### Follow-ups (noticed, not done)
- No `pnpm format` script exists, though the implementer rules mention one; `CLAUDE.md` should say so or add one.
- `lintMigration` is exported from a test file only for local fixtures; STK-087 may want to move it if the runner reuses the rules.

### Scope self-check
- Could the diff be smaller? No; the baseline is mechanical and every other file is in the plan.
- Diff size: tracked files +14 / -34; new files about 800 lines (baseline 492, tests 190, script 98, rollback 22).

## Attempt 2 (REWORK: Ming's fixes after review attempt 1 PASS; security-review lint findings, `-k` nit, recommendation 2)

### Files touched
- `packages/db/src/migrations-lint.test.ts`: required because the lint findings live here.
  - `TOKEN_RE` now also tokenises E-strings (`E'..\'..'`), double-quoted identifiers, and dollar tags with digits (`$f1$`).
  - `FORBIDDEN` is now an explicit `[label, regex]` list. It adds `create schema` and `owner to`.
  - `set role` is widened to `SET [LOCAL|SESSION] ROLE`, `RESET ROLE` and `set_config('role', ...)`. `set session authorization` accepts `LOCAL`/`SESSION`.
  - The baseline `do` ban is now `/\bdo\s+(language\s+\w+\s+)?(\$|')/i`.
  - New fixture tests: `tokeniser bypass fixtures` (E-string, `"a--b"` identifier, `$f1$` with `--`, `$f1$` with `'` hiding `commit;`, `e'it''s'`, a quoted identifier with `;commit`), `role, schema and owner fixtures`, `baseline do-block fixtures`. The real baseline still passes.
- `packages/db/test-db/baseline.test.ts`: required because of recommendation 2.
  - `relations have no PUBLIC privileges`: aclexplode over `pg_class.relacl` for relkinds r/p/v/m/f/S, with `acldefault` when the ACL is NULL. `acldefault`'s kind argument is cast to `"char"`. It asserts grantee 0 is absent, and that rows exist at all.
  - `schema public gives PUBLIC at most USAGE; no extra schemas`: the same on `pg_namespace.nspacl`, and no schemas other than `public`, `information_schema` and `pg_*`.
- `scripts/schema-diff.sh`: `-k '$TMP'` quoted inside `-o`.

### Proof the new ACL check can fail
- On PG16, I appended `grant select on public.settings to public;` to the baseline temporarily. `pnpm test:db` then gave `FAIL baseline > relations have no PUBLIC privileges` (1 failed, 126 passed).
- I restored the baseline from a copy; `test:db` is green again (23 files, 127 tests).
- The same SQL on a scratch database returned no rows before the grant, `settings | SELECT` after it, and no rows after the revoke. The scratch database was dropped.

### Checks (actual output summary)
- typecheck: exit 0. lint: 0 errors.
- test: core 834, sources 35, ai 184, db 115, worker 299, web 352 passed.
- test:db (PG 16 on 127.0.0.1:54399, trust, throwaway cluster): 23 files, 127 tests passed.
- db:check: `db:check OK`.
- `bash scripts/schema-diff.sh`: `A' vs B: identical`, rollback leaves `0|0|0`.
- build and format: not run (build is unaffected; the repo has no `format` script).

### Out-of-plan files
None.

### Follow-ups
- Not done (outside the list): the security review's remaining items, namely running `test:db` migrations as a non-superuser (STK-086) and the deployment repo's `revoke connect ... from public`.

### Scope self-check
Only the three listed files changed. The temporary PG data dir and the schema-diff temp dirs are deleted. Nothing was committed.
