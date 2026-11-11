# STK-082: AI provider keys encrypted app-side, replacing Vault (STK-080 slice c)

| Field | Value |
|---|---|
| State | REWORK |
| Priority | P1 |
| Areas | security, db, architecture |
| Attempts | 2 |
| Created | 2026-11-11 |
| PR | — |

## Goal
Split from STK-080 (see work/tickets/STK-080/plan.md "Split proposal"; consults in work/tickets/STK-080/), re-scoped on 2026-11-11 to the deployment repo's shared-Postgres standard. Scope:

New forward migration (runs on db:check; becomes part of the STK-083 baseline): `ai_keys(provider pk, ciphertext bytea, iv bytea, auth_tag bytea, key_version smallint, last4, updated_at)` with the format/last4 checks. Drop `ai_key_set/delete/secrets`. AES-256-GCM in `packages/db` (`keyring.ts`, AAD = provider) with master key `STOKTOK_AI_KEYS_MASTER_KEY` (32 bytes base64, server-only). Public functions unchanged via `keyring` on the handle. Fail-closed rules from ADR 0009 §3–6 kept: no stored rows and no key → env fallback; rows but a missing or wrong key → `provider_unavailable`. ADR 0011 supersedes 0009. checks.sql ai_key sections rewritten (definer allowlist empty). r3-guard rewritten (decrypt only in keyring/repo). Deploy plumbing for the master key goes to STK-084.

## Shared-Postgres standard (deployment repo, Ming 2026-11-11)
Follow how TuDoCuaTui (D23–D25) and org-admin-api use the shared Postgres in `mmlabs-online/deployment`:
- `postgres:17`, reachable only as `postgres:5432` on the external Docker network `db`; no published port, no TLS on that hop.
- One login role + one database per app, same name (`stoktok`), created by `bash postgres/scripts/add-app-db.sh stoktok` (password in `postgres/secrets/apps/stoktok.password`, app listed in `postgres/config/databases`). The role owns its database and schema `public`; it has no CREATEROLE/CREATEDB/superuser. The same role runs the app and the migrations (least-privilege runtime role is a later follow-up, as in TuDo D24).
- The deploy workflow writes the URL into the host env file from the committed password file (no GitHub secret). stoktok keeps the env name `STOKTOK_DATABASE_URL` (STK-080 guards).
- Migrations: a one-shot `migrate` compose service, run by the deploy after a pre-migration dump (`pg-backup /backup.sh`) and before the app is replaced; a failed migration leaves the old release running. Pattern: TuDoCuaTui `server/migrator.js` (plain SQL `YYYYMMDDHHMMSS_name.sql`, forward-only, checksums in a migrations table, advisory lock, one transaction per file).
- Backups: automatic by the `pg-backup` sidecar for every database in `config/databases` (02:00 daily, 7d/4w/6m, offsite at 03:30).
- No RLS for single-user (TuDo D25 pattern).

**Release rule:** STK-081 to STK-083 merge to main but no stoktok release is cut until STK-084; production stays on the current Supabase-backed release until the cutover. There is no interim hop to Supabase's Postgres.

## Spec reference
CLAUDE.md Stack, R2, R3, R5, R6, R8; ADR 0010 (from STK-080). Reference repos: `mmlabs-online/deployment` (`postgres/`, `apps/tudocuatui/`, `.github/workflows/deploy-tudocuatui.yml`), `mmlabs-online/TuDoCuaTui` (`server/db.js`, `server/migrator.js`, `db/migrations/README.md`, `work/decisions.md` D23–D25). Depends on STK-085.

## Acceptance criteria
- [ ] Every item in the scope above is done, following the shared-Postgres standard.
- [ ] Production keeps working: until STK-084's cutover no stoktok release is cut, and nothing in this slice changes the running release.
- [ ] `typecheck`, `lint`, `test`, `test:db` and `db:check` green; changed `packages/db` logic has tests.

## Notes / answers from Ming
- 2026-11-11 (orchestrator): split from STK-080 per its plan.md; Ming's decisions are in work/tickets/STK-080/ticket.md (Postgres container on a shared Docker network, squashed baseline, pg + Kysely, accept Supabase Free pausing).
- 2026-11-11 (Ming): re-scoped to the deployment repo's shared-Postgres standard (see above); replaces the earlier interim plan of pointing production at Supabase's Postgres over TLS and the stoktok_owner/stoktok_app role pair.
- Ming's manual step: none until STK-084 (master key is set during the cutover; AI keys are re-entered on Settings after it). Open: master key stored in the deployment repo next to the DB password file (shared-Postgres style) or as a GitHub environment secret — decide in this ticket's plan.
- 2026-11-11 (Ming, after consults): (1) the AI master key is a GitHub environment secret `STOKTOK_AI_KEYS_MASTER_KEY` in the `stoktok` environment (written to the host env file by the deploy workflow in STK-084), with a copy in Ming's password manager; never committed to the deployment repo. (2) Rotation in v1 is a manual runbook in ADR 0011 (delete keys on Settings → swap secret → redeploy → re-enter); a multi-version keyring is a follow-up.
- Orchestrator note: both consults agree the new migration must NEVER be applied to the live Supabase project (the running release still calls the Vault RPCs); the Vault cleanup on Supabase belongs to the STK-084 runbook. The Vault stub in db:check stays until STK-083.
- 2026-11-11 (Ming, after review attempt 1 PASS): fix ADR 0011 before the PR, from security-review.md attempt 1: 🟡2 (cutover: issue NEW provider keys at Anthropic/Google, enter those on Settings, revoke the old ones; delete the `stoktok_ai_key_%` Supabase Vault rows only after the rollback window closes — "and", not "or") and 🟡3 (master-key rotation runbook: rows sealed under the old key are not discarded automatically, they disable both providers until deleted on Settings; on suspected master-key compromise also rotate the provider keys; old-key copies must be destroyed once backups sealed under it have aged out, or rotate provider keys). Doc-only; no code change.
