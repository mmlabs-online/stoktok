# STK-090 security review

## Attempt 1

**Verdict: no 🔴 findings.** The SQL that uses the derived password is validated before it is built, the role cannot escalate, a tampered role is repaired or refused, R3 still holds, and a setup failure cleans up after itself. There are four 🟡 hardening items below and one process gap. I read the code only: I did not run any checks and relied on impl-log for the green results.

### Findings

**What I checked and found correct**

- **SQL built with the password** (`packages/db/test-db/owner.ts:34,40-41`)
  - The `^[0-9a-f]{64}$` check runs before `begin` and before anything is interpolated. The fake-client test proves no query runs for `''`, 63 characters, uppercase hex, or a `'; drop role` payload (`src/test-db-guard.test.ts:98-104`).
  - Role names and attributes are module constants (`owner.ts:10,14`).
  - `TEMPLATE` and the clone names come from `process.pid` and a counter only (`global-setup.ts:7-8`, `harness.ts:41,60`). They are unquoted but cannot carry input.
- **Role attributes and memberships** (`owner.ts:41-46`)
  - On an existing role, `alter role … with login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password …` re-asserts every flag.
  - The `pg_auth_members` check fails closed on any membership, inside the same transaction. That covers a superuser role and also `pg_execute_server_program`, `pg_read_server_files` and `pg_write_server_files`, the realistic routes from a non-superuser login to the shell.
  - On refusal the `alter` is rolled back. The role keeps its tampered flags, but setup exits 1 and nothing runs as it.
  - The retry on 42710/23505 runs the membership check again, and there is no `drop role` anywhere.
  - Real-Postgres proofs: `owner.test.ts:73-83` (42501 on `create role` and `create database`), `:99-110` (CREATEDB tampering repaired, two concurrent calls) and `:112-128` (a membership is refused).
- **Password derivation** (`owner.ts:17-30`)
  - The owner password is sha256 of a label plus the admin password, so the admin password cannot be recovered from it.
  - `asOwner` output never contains the admin password (tested at `test-db-guard.test.ts:71`).
  - Nothing new is logged. Setup prints only `error.message` (`global-setup.ts:73`), and none of the new error messages contain the URL or a password.
  - The admin URL is parsed by `checkAdminUrl` before `ownerPassword` runs, so Node's `Invalid URL` error (which carries `input`) cannot fire on that path.
- **R3**
  - `STOKTOK_DATABASE_URL` appears in `packages/db` only in `src/pg/client.ts` and `client.test.ts`.
  - The new files use the `DATABASE_URL_ENV` constant, as the existing test-db files already do.
  - The r3-guard allow-lists are unchanged: the `runMigrations` allow covers `packages/db/test-db/` (`r3-guard.test.ts:189-194`).
- **Non-test database guard**
  - `checkAdminUrl` is unchanged: localhost only, and it refuses `host`, `hostaddr` and `port` query parameters.
  - `ownPublicSchema` only runs on databases that test:db just created (the template and `emptyDb` names). Nothing touches `postgres` or `template1`, as the consult §6 required.
- **Cleanup on failure** (`global-setup.ts:55-76`)
  - Role setup, template creation, `ownPublicSchema` and the migration as the owner are all inside the `try`. A failure in any of them drops every `stoktok\_test\_%\_<pid>` database.
  - If `emptyDb`'s `ownPublicSchema` fails, the database is left until the teardown sweep catches it.
  - db:check refuses only non-system databases and the roles `stoktok`, `stoktok_nobody` and `dbcheck_canary` (`scripts/db-check.sh:152-154`). The leftover `stoktok_test_owner` role does not trip it, and that is guarded at `test-db-guard.test.ts:161-169`.

**🟡 Hardening items**

1. 🟡 **Settings stored on the role are not reset** (`owner.ts:41`). `alter role … with …` leaves any `alter role stoktok_test_owner set …` in place. A superuser can store settings such as `session_replication_role = replica` (disables triggers) or `search_path`, and the owner then logs in with them. Tests could pass that should fail. This hurts test reliability; it does not give the owner more rights. Fix: add `alter role stoktok_test_owner reset all` inside the same transaction, or include `rolconfig is not null` in the fail-closed check.

2. 🟡 **The derived password is sent as plaintext SQL** (`owner.ts:40-41`). With `log_statement = ddl/all`, or when the statement errors (the default `log_min_error_statement=error`, e.g. on the 42710 race), the server log shows the hex value. GitHub Actions prints service-container logs when the job ends. Impact is low: it is a one-way hash of a local or CI admin password, and plan A4 accepts this risk. If you want it closed: compute a SCRAM-SHA-256 verifier in Node and send `password 'SCRAM-SHA-256$4096:…'`, so logs only ever show a verifier.

3. 🟡 **test:db now leaves a permanent login role on whatever cluster `DB_TEST_URL` reaches** (`global-setup.ts:67`). Before this change, test:db left nothing behind after teardown. `checkAdminUrl` only checks for localhost, so a localhost tunnel to a shared or production cluster with superuser credentials would pass. The production Postgres has no published port, so this is unlikely. If the admin URL has no password, the owner password is `sha256('stoktok-test-owner:v1:')`, a fixed value anyone can compute. It only matters if `pg_hba` allows that role over the network. Recommendation (follow-up, not this diff, R7): a pre-flight refusal like db:check's, for example refusing when the cluster has `stoktok` or `org_admin` databases or roles. Also document `drop role stoktok_test_owner` as the manual cleanup.

4. 🟡 **The membership test can leak a role, and only some escalation paths are checked** (`owner.test.ts:115-118`).
   - `create role stoktok_test_m_<pid>` runs outside the `try`. If the `grant` fails, that role is never dropped (it does not affect db:check).
   - Separately, the fail-closed check covers role flags and memberships only. Direct grants such as `grant execute on function pg_read_binary_file(...)` to the owner are not detected. Only a superuser could add such a grant, so this affects test reliability, not a privilege boundary. Leave it as is; noted for completeness.

**Process gap (for the reviewer)**

The negative proof planned in Approach step 6 (remove `owner` from `freshDb` and watch it fail) was not done (impl-log "Not done"). It is not a security defect, but it is the only evidence that `owner.test.ts` fails when ownership is wrong.

### Recommendations
- **Plan criterion 4 / ticket "tampered role":** add `reset all` (item 1). It is a one-line change inside the existing transaction, plus one fake-client assertion.
- **R8 / plan step 6:** run the negative proof before PASS, or the reviewer accepts the gap explicitly.
- **R7:** items 2 and 3 go to follow-ups, not into this diff.

### Risks
- Running on a cluster that is not a test server depends only on the existing localhost check, and test:db now leaves a permanent login role behind (item 3).
- The derived password can appear in Postgres server logs when the statement errors (item 2). This risk was accepted in plan A4.

### Open questions
- Should a password-less admin URL (trust auth) be refused, or should the owner then get a random password? Concurrent runs would no longer agree on a random password, so this needs a decision.

Files reviewed:
- /home/user/stoktok/packages/db/test-db/owner.ts
- /home/user/stoktok/packages/db/test-db/owner.test.ts
- /home/user/stoktok/packages/db/test-db/global-setup.ts
- /home/user/stoktok/packages/db/test-db/harness.ts
- /home/user/stoktok/packages/db/src/test-db-guard.test.ts
- /home/user/stoktok/packages/db/src/r3-guard.test.ts
- /home/user/stoktok/scripts/db-check.sh
- /home/user/stoktok/db/migrations/README.md
- /home/user/stoktok/docs/adr/0010-self-hosted-postgres-data-layer.md
