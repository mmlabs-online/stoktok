# STK-082: AI provider keys encrypted app-side, replacing Vault (STK-080 slice c)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | security, db, architecture |
| Attempts | 0 |
| Created | 2026-11-11 |
| PR | — |

## Goal
Split from STK-080 (see work/tickets/STK-080/plan.md "Split proposal"; consults in work/tickets/STK-080/). Scope:

New forward migration (runs on Supabase and db:check): `ai_keys(provider pk, ciphertext bytea, iv bytea, auth_tag bytea, key_version smallint, last4, updated_at)` with the format/last4 checks. Drop `ai_key_set/delete/secrets` and the stored Vault secrets. AES-256-GCM in `packages/db` (`keyring.ts`, AAD = provider) with master key `STOKTOK_AI_KEYS_MASTER_KEY` (32 bytes base64, server-only). Public functions unchanged via `keyring` on the handle. Fail-closed rules from ADR 0009 §3–6 kept: no stored rows and no key → env fallback; rows but a missing or wrong key → `provider_unavailable`. ADR 0011 supersedes 0009. checks.sql ai_key sections rewritten (definer allowlist empty). r3-guard rewritten (decrypt only in keyring/repo; Vault rule kept). Deploy env plumbing for the master key. Ming re-enters keys

## Spec reference
STK-080 ticket ACs: AC4. CLAUDE.md Stack, R2, R3, R5, R6, R8; ADR 0010 (from STK-080). Depends on STK-081.

## Acceptance criteria
- [ ] Every item in the scope above is done, meeting the STK-080 ticket ACs listed (AC4) for this slice.
- [ ] Production keeps working after this slice is deployed on its own (strangler path in STK-080 plan.md).
- [ ] `typecheck`, `lint`, `test`, `test:db` and `db:check` green; changed `packages/db` logic has tests.

## Notes / answers from Ming
- 2026-11-11 (orchestrator): split from STK-080 per its plan.md; Ming's decisions are in work/tickets/STK-080/ticket.md (Postgres container on a shared Docker network, squashed baseline, pg + Kysely, accept Supabase Free pausing).
- Ming's manual step: Set `STOKTOK_AI_KEYS_MASTER_KEY`, then re-enter the AI keys on Settings. Open: confirm the master key lives in the deploy repo secrets next to the DSN (default); rotation is a follow-up.
