# STK-083 security review

## Security review: STK-083, attempt 1

**Verdict: no blocking findings.** The baseline is clean. Every finding below is 🟡 hardening or 🟢 confirmation. Nothing here needs a REWORK. I made no file changes.

### Findings

**Baseline contents**
- 🟢 `db/migrations/20261111000200_baseline.sql`: it contains no grant, role, RLS, policy, Vault, extension, `do` block or `drop`.
  - Both functions are `security invoker` and `set search_path = ''`, at :390-391 and :429-430.
  - Their bodies use the `pg_catalog.` and `public.` prefixes.
  - The two `revoke execute ... from public` statements are at :437-438.
- 🟢 Baseline :482-490 matches `supabase/migrations/20261111000100_ai_keys_app_encryption.sql:25-35` column for column and check for check. A' vs B being identical in `schema-diff.md` confirms this.
  - The Vault guard (`do $$` at :12-18 of that file), RLS and grants are dropped, as F2 requires.
- 🟢 Removing the Vault guard is safe. The baseline has no `drop` or `if not exists`, so it fails with 42P07 on its first `create table` against any database that already has the schema, including the live Supabase project. Nothing destructive can happen. `baseline.test.ts:77-93` asserts this.
- 🟢 The function revokes matter more on shared Postgres. New databases give CONNECT to PUBLIC, and PUBLIC keeps USAGE on schema `public`, so other app roles on the shared server (tudocuatui, org_admin) could otherwise call `ai_reserve`.
  - `baseline.test.ts:43-47` checks PUBLIC execute on *every* function in `public`, not just these two, so a future function that forgets its revoke fails `test:db`.
- 🟢 `baseline.test.ts:32-41` checks the catalog directly:
  - no `relrowsecurity` and no policies;
  - only the `plpgsql` extension;
  - `prosecdef = false`;
  - `search_path=""` in `proconfig`.

  This is the real gate: it runs on the template built from all of `db/migrations`, so it also covers future files.

**Lint rules (`packages/db/src/migrations-lint.test.ts`)**
- 🟡 :14 `TOKEN_RE` doesn't tokenise SQL the way Postgres does, so a banned statement can hide behind a fake "comment" on the same line:
  - **E-string escapes:** `select E'\' -- '; grant select on t to x; -- ';` The regex ends the string at `\'`, then treats `-- ...` as a comment and strips the `grant`. Postgres runs the `grant`.
  - **Double-quoted identifiers:** `create table "a--b" (c int); grant ... on "a--b" to y;` The `--` inside `"..."` is read as a comment.
  - **Dollar tags with digits:** `\$([A-Za-z_]*)\$` doesn't match `$f1$`. A `--` inside such a body hides the rest of the line, and a `'` inside it hides `commit;` from the TX check, because `stripLiterals` swallows text up to the next quote.
  - **Risk:** low, because this needs deliberate obfuscation rather than an accidental AI default, and the catalog tests above still catch RLS, definer and PUBLIC execute.
  - **Fix:** add `"(?:[^"]|"")*"` and `[Ee]'(?:[^'\\]|\\.|'')*'` alternatives, allow `[A-Za-z_][A-Za-z0-9_]*` in dollar tags, and add a fixture for each case.
  - Keep treating the lint as a guardrail, not a boundary.
- 🟡 :36 `set\s+role` misses:
  - `SET LOCAL ROLE`, `SET SESSION ROLE`, `RESET ROLE`;
  - `set_config('role', …)`;
  - `SET LOCAL SESSION AUTHORIZATION`.

  **Impact:** small. The owner role belongs to no other role, so it can't switch to anything useful. **Fix:** use `set\s+(local\s+|session\s+)?(role|session\s+authorization)` and `set_config\s*\(\s*'role'`.
- 🟡 :26-43 doesn't ban two things. Neither appears in the baseline today:
  - `create schema`: objects in another schema escape both `schema-diff.sh` (`--schema=public`) and every `baseline.test` query, all of which filter on `'public'::regnamespace`.
  - `owner to`.

  **Fix:** ban both, or add a catalog check in `baseline.test.ts` that `pg_namespace` has no schemas beyond `public`, `pg_*` and `information_schema`.
- 🟡 :80 `do\s+\$` (baseline only) misses `do language plpgsql $$…$$` and `do '…'`. This matters only for the baseline and is low. Use `/\bdo\s+(language\s+\w+\s+)?(\$|')/i`.
- 🟢 :59/:72 only lint up-migrations; rollbacks are not linted. This is acceptable, since rollbacks are test-only (README :10).
- 🟢 :45/:52 the transaction-control check plus `global-setup.ts:85` (`begin; … commit;` wrapping) correctly stops a file from breaking out of its transaction, apart from the tokeniser gaps above.

**`scripts/schema-diff.sh`**
- 🟢 Credentials and temp cluster are handled safely:
  - `mktemp -d` (mode 0700), a socket inside it, and `listen_addresses=''` (:36, :44-45). Trust auth is reachable only by the owning user, with no TCP and no secrets.
  - The `trap cleanup EXIT` (:15-21) stops the cluster and deletes `$TMP`.
  - `OUT` keeps only schema dumps.
  - Running as root goes through `runuser`.
- 🟡 :48 `--no-privileges` and `--no-owner` mean the faithfulness proof can't see grants, revokes or ownership. "A' vs B identical" therefore says nothing about the two revokes. `schema-diff.md:173` documents this, and `baseline.test.ts:43-47` covers functions.
  - **Gap:** table, sequence and schema ACLs are checked nowhere in this slice. A `grant … to public` hidden by the tokeniser bugs above would pass both the diff and the tests.
  - **Fix:** extend the aclexplode check in `baseline.test.ts` to `pg_class.relacl` and `pg_namespace.nspacl` (grantee 0 = PUBLIC). Alternatively, add a pre-normalisation `\dp`-style ACL dump of B to the script output.
- 🟢 :49-50 the normalisation doesn't hide definer or search_path changes:
  - It deletes only `ENABLE ROW LEVEL SECURITY;` lines and the comment-only `ROW SECURITY` headers.
  - `SECURITY DEFINER`, `SET search_path`, `FORCE ROW LEVEL SECURITY` and `CREATE POLICY` would all still show up. The recorded A-vs-B diff shows the three legacy `SECURITY DEFINER` `ai_key_*` functions, which confirms it.
  - A newly added `ENABLE RLS` on B would be hidden, but the lint and `baseline.test.ts:34` catch it.
- 🟢 :72-76 B runs as a role with every privilege flag false, so the baseline needs no superuser. Rollback leaves `0|0|0` (:78-80).
- 🟡 :45 `-k $TMP` is unquoted inside `-o`. This is cosmetic (mktemp paths have no spaces). Write `-k '$TMP'`.
- 🟡 Running the baseline as a non-superuser is proven once, by hand. CI's `test:db` (`global-setup.ts:78-86`, `DB_TEST_URL` = `postgres` superuser) doesn't check it. Until STK-086 lands, a future migration that needs superuser rights passes CI. Track this under STK-086.

**`test:db` template and CI**
- 🟢 `global-setup.ts:79-83` applies `db/migrations/*.sql` only, rejects badly named files, and no longer uses `supabase/` or the bootstrap.
- 🟢 `checkAdminUrl` (:10-23) still forces a local host and blocks `host`, `hostaddr` and `port` overrides.
- 🟢 `ai-keys.test.ts`: dropping the Vault-guard block is correct, because the guard no longer exists. Plaintext-never-stored, fail-closed and no-secret-in-error tests are kept.
- 🟢 `.github/workflows/ci.yml:25`: `postgres:17` on a throwaway runner with password `postgres` is fine, and `permissions: contents: read` stays.
  - Note: `db:check` (:51) still runs the legacy chain on PG17, while `supabase/README.md:12` says "Postgres 16". This is a doc-only mismatch; let STK-086 handle it.

### Recommendations
1. Harden `TOKEN_RE` and add fixtures for E-strings, `"…--…"` identifiers and digit dollar tags (`migrations-lint.test.ts:14`). Widen the `set role` pattern (:36). Ban `create schema` and `owner to`. (This applies R3 / the ADR 0010 single-owner rule to future migrations.)
2. Add PUBLIC-ACL checks on `pg_class` and `pg_namespace`, plus a "no extra schemas" check, to `baseline.test.ts`. This makes the catalog the gate, not the regex.
3. In STK-086, run the `db:check` / `test:db` migrations as the non-superuser owner, so CI proves on every PR what `schema-diff.sh` proved once by hand.

### Risks
- The lint can be bypassed with obfuscated SQL (low likelihood). The catalog tests catch the worst outcomes (RLS, definer, PUBLIC execute) but not table or schema grants.
- Until STK-086, CI doesn't prove that migrations run without superuser rights.

### Open questions
- Does the deployment repo's `add-app-db.sh` run `revoke connect on database stoktok from public`? If not, every other app role on the shared Postgres can connect to stoktok and keeps USAGE on `public`. Table data is still protected because there are no grants, and functions by the revokes, but it widens what an attacker gets from compromising another app. This lives in the deployment repo; raise it with Ming as a follow-up.

### Files reviewed
- /home/user/stoktok/db/migrations/20261111000200_baseline.sql
- /home/user/stoktok/db/rollback/20261111000200_baseline.down.sql
- /home/user/stoktok/db/migrations/README.md
- /home/user/stoktok/packages/db/src/migrations-lint.test.ts
- /home/user/stoktok/packages/db/test-db/global-setup.ts
- /home/user/stoktok/packages/db/test-db/baseline.test.ts
- /home/user/stoktok/packages/db/test-db/ai-keys.test.ts
- /home/user/stoktok/packages/db/test-db/harness.ts
- /home/user/stoktok/scripts/schema-diff.sh
- /home/user/stoktok/.github/workflows/ci.yml
- /home/user/stoktok/supabase/README.md
- /home/user/stoktok/supabase/migrations/20261111000100_ai_keys_app_encryption.sql
- /home/user/stoktok/work/tickets/STK-083/schema-diff.md

## Security review: STK-083, attempt 2

**Verdict: no blocking findings.** All attempt-1 items in scope are fixed. I found two new 🟡 hardening gaps and one 🟢 nit; none of them needs a REWORK. I made no file changes. Recommendation 3 is deferred to STK-086 as agreed.

### Attempt-1 items
| Item | Status |
|---|---|
| `TOKEN_RE`: E-strings, `"a--b"`, `$f1$` tags | **Fixed.** `migrations-lint.test.ts:15-16` handles all three. The lookbehind on `E'` avoids false matches inside identifiers. Fixtures at :102-109 cover all three cases plus `$f1$ '` hiding `commit;`. |
| `set role` variants | **Fixed.** :40-42 now catch `SET LOCAL/SESSION ROLE`, `RESET ROLE`, `set_config('role'` (including `pg_catalog.`-qualified calls) and `SET LOCAL/SESSION SESSION AUTHORIZATION`. Fixtures are at :111-114. |
| `create schema` / `owner to` | **Fixed.** Both are banned at :34-35, with fixtures at :115-117, including the negative case `role`/`owner_id` columns. |
| Baseline `do` ban | **Fixed.** :85 uses `/\bdo\s+(language\s+\w+\s+)?(\$\|')/i`. |
| Rec. 2: PUBLIC ACLs on relations and schemas, no extra schemas | **Fixed.** `baseline.test.ts:49-53` covers relkinds r/p/v/m/f/S, falling back to `acldefault` when the ACL is NULL, and checks that rows exist. :55-60 checks that `public` gives PUBLIC only USAGE and that no extra schemas exist; the `pg\_%` escape is correct. impl-log shows the test fails when a grant is injected. |
| `-k` quoting | **Fixed.** `scripts/schema-diff.sh:45` now has `-k '$TMP'`. |

### New findings
- 🟡 `packages/db/test-db/baseline.test.ts:49-53` **does not cover column-level grants.** `grant select (col) on t to public` is stored in `pg_attribute.attacl`, not `pg_class.relacl`, so this test would not see it. The lint bans `grant`, so this only matters if the lint is bypassed (see the next item). **Fix:** add `select attrelid::regclass, attname from pg_attribute a cross join lateral aclexplode(a.attacl) x where a.attacl is not null and x.grantee = 0` filtered to the `public` namespace and expect `[]`. Optionally also assert that `pg_default_acl` is empty.
- 🟡 `packages/db/src/migrations-lint.test.ts:16` **still has two ways to hide a statement from the tokeniser.** Both need deliberate obfuscation, so the risk is low. In each case the lint misses a `grant` that Postgres would run:
  - **`$` inside an identifier:** `select 1 as x$a$; grant select on t to public; -- $a$`. Postgres reads `x$a$` as an identifier. The regex instead reads `$a$…$a$` as a dollar-quoted body and swallows the `grant`. **Fix:** add `(?<![A-Za-z0-9_$])` before the `\$` alternative.
  - **Nested block comments:** `/* /* */ ' */ grant …; -- '`. Postgres nests `/* */`, so the comment ends at the second `*/`. The regex ends it at the first `*/`, then reads `' */ grant …; -- '` as a string. **Fix:** reject any file that has `/*` inside a block comment, or ban block comments in migrations entirely, which is the simplest option.

  Add a fixture for each. The catalog checks remain the real gate, and with the attacl check added they would catch either bypass.
- 🟢 `migrations-lint.test.ts:85` and `:121` each contain their own copy of the do-block regex, so the fixture tests the copy and not the regex that guards the baseline. Move it into a shared const.

### Still open (unchanged from attempt 1)
- The deployment repo's `revoke connect on database stoktok from public` is still a follow-up to raise with Ming.

### Files reviewed
- /home/user/stoktok/packages/db/src/migrations-lint.test.ts
- /home/user/stoktok/packages/db/test-db/baseline.test.ts
- /home/user/stoktok/scripts/schema-diff.sh
- /home/user/stoktok/work/tickets/STK-083/impl-log.md
