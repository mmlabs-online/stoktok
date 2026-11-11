# STK-084: Register stoktok on the shared Postgres, move data from Supabase, cutover and docs (STK-080 slice e)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | db, data, architecture, security |
| Attempts | 0 |
| Created | 2026-11-11 |
| PR | — |

## Goal
Split from STK-080 (see work/tickets/STK-080/plan.md "Split proposal"; consults in work/tickets/STK-080/), re-scoped on 2026-11-11 to the deployment repo's shared-Postgres standard. Scope:

Deployment repo (a PR there, as TuDoCuaTui did): `bash postgres/scripts/add-app-db.sh stoktok`; `apps/stoktok/compose.yml` joins `stoktok-web` and `stoktok-worker` to the external `db` network and adds a `migrate` one-shot service (profile `migrate`); `deploy-stoktok.yml` writes `STOKTOK_DATABASE_URL=postgres://stoktok:<pw>@postgres:5432/stoktok` from `postgres/secrets/apps/stoktok.password` (plus the AI master key) into the host env file, takes a pre-migration dump via `pg-backup /backup.sh`, runs `migrate` before replacing the app, and drops the Supabase DB secrets (AUTHEN_* stay). Add `/readyz` (DB ping) if the deploy health check needs it. `scripts/db-migrate-from-supabase.sh`: refuses a non-empty target unless forced; schema from the baseline via the migrate runner; `pg_dump --data-only --schema=public --no-owner --no-privileges --exclude-table=public.ai_keys -Fc` from Supabase (direct or session pooler, port 5432; no `--inserts`); `pg_restore --single-transaction` into `stoktok` via the `db` network; `setval` for the 6 identity sequences; per-table count plus ordered md5 verification. Runbook: dry run on a scratch DB, then stop worker → dump → restore → verify → cut the first Postgres release → start, with Supabase tables kept for a rollback window. Backups come from the existing `pg-backup` sidecar (no LaunchAgent). CLAUDE.md Stack (DB row; OrbStack on an Intel Mac instead of WSL2), Conventions (secrets); spec §7 diagram, secrets line and risks row (Supabase Free pausing accepted).

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
CLAUDE.md Stack, R2, R3, R5, R6, R8; ADR 0010 (from STK-080). Reference repos: `mmlabs-online/deployment` (`postgres/`, `apps/tudocuatui/`, `.github/workflows/deploy-tudocuatui.yml`), `mmlabs-online/TuDoCuaTui` (`server/db.js`, `server/migrator.js`, `db/migrations/README.md`, `work/decisions.md` D23–D25). Depends on STK-083, STK-086, STK-087 and STK-088.

## Acceptance criteria
- [ ] Every item in the scope above is done, following the shared-Postgres standard.
- [ ] Production keeps working: until STK-084's cutover no stoktok release is cut, and nothing in this slice changes the running release.
- [ ] (from STK-082 plan F1/F3 and security review 🟡1–2) AI master key: generate (`head -c 32 /dev/urandom | base64`), set the `stoktok` environment secret `STOKTOK_AI_KEYS_MASTER_KEY` (copy in Ming's password manager, never in the deployment repo), wire the deploy workflow and `check-deploy-env.sh` (required, format `^[A-Za-z0-9+/]{43}=$`), switch its `docs/deploy.md` row from `reserved` to required, host env file mode 0600. At cutover issue NEW provider keys at Anthropic/Google and enter those on Settings, then revoke the old keys; delete the `stoktok_ai_key_%` rows from Supabase Vault only after the rollback window closes. Confirm `ai_keyring_invalid` never appears in the logs after cutover.
- [ ] `typecheck`, `lint`, `test`, `test:db` and `db:check` green; changed `packages/db` logic has tests.

## Notes / answers from Ming
- 2026-11-11 (orchestrator): split from STK-080 per its plan.md; Ming's decisions are in work/tickets/STK-080/ticket.md (Postgres container on a shared Docker network, squashed baseline, pg + Kysely, accept Supabase Free pausing).
- 2026-11-11 (Ming): re-scoped to the deployment repo's shared-Postgres standard (see above); replaces the earlier interim plan of pointing production at Supabase's Postgres over TLS and the stoktok_owner/stoktok_app role pair.
- Ming's manual step: merge the deployment-repo PR, run the cutover runbook, re-enter AI keys on Settings. Open: how long to keep the Supabase tables after cutover (proposed 14 days).
- 2026-11-11 (Ming): the GitHub environment secret `STOKTOK_AI_KEYS_MASTER_KEY` is created in the `stoktok` environment (copy in the password manager).
- 2026-11-11 (orchestrator): from STK-083 plan follow-ups: optional live-Supabase `pg_dump --schema-only` comparison in the cutover runbook (F1); `idle_in_transaction_session_timeout` set in `pg/client.ts` session init or the deployment repo DB config, not a migration (F2); update the CLAUDE.md Stack DB row and "Migrations in `supabase/`" (F3).
