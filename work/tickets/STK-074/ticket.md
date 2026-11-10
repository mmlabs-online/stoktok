# STK-074: AI provider keys in Supabase Vault and key resolution (slice a)

| Field | Value |
|---|---|
| State | IN_PROGRESS |
| Priority | P2 |
| Areas | security, db, architecture, ui |
| Attempts | 0 |
| Created | 2026-11-10 |
| PR | — |

## Goal
Let Ming enter the Anthropic and Google AI API keys on the Settings screen, store them encrypted in Supabase Vault, and have the server-side AI client use them (falling back to the STK-072 env keys), without a key ever reaching the browser or the logs.

## Spec reference
docs/spec-v1.md §7 Deployment ("Secrets … LLM API key only in the deploy repo's env handling") — **this ticket changes that rule by Ming's decision (2026-11-10)**; §9 open question 6 (LLM provider, "reuse … Ricotdin"); §5 `settings`. CLAUDE.md R3, R6, Conventions (secrets). Depends on STK-073 (merged).

## Acceptance criteria
- [ ] Settings has a "Khoá AI" card (one row per provider: Anthropic, Google AI) to paste and save a key, replace it, and delete it. After saving, only the last 4 characters (and the saved date) are shown; the full key is never rendered, returned by any server action, or sent to the browser again.
- [ ] Keys are stored in Supabase Vault (encrypted at rest), readable and writable only by `service_role`; anon/authenticated have no access to the secrets or to any helper function. Migration with a rollback file and `db:check` cases.
- [ ] The save/delete server actions call `requireUser()` first (R6), validate the key format (no whitespace or newlines, reasonable length) and never echo the value in errors or logs.
- [ ] Key resolution on the server: a key saved via the UI wins; otherwise the STK-072 env key is used; otherwise that provider is disabled. Web and worker pick up a changed or deleted key without a container restart (no stale singleton).
- [ ] R3 holds: the keys and Vault access stay server-only; the r3-guard and the client-bundle check still pass, with any new server module covered.
- [ ] CLAUDE.md (Conventions: secrets) and spec §7 are updated to record the new rule, and an ADR records the decision (Vault, precedence, threat model).
- [ ] `typecheck`, `lint`, `test`, `db:check` and the client-bundle check are green; tests cover precedence, delete, format rejection and that no action returns the key.

## Notes / answers from Ming
- 2026-11-10 (Ming): (1) UI = a "Khoá AI" card on Settings: paste, save, then show only the last 4 characters with replace and delete; the key is never sent back to the browser. (2) Storage = Supabase Vault (encrypted, service_role only, decrypted only on the server). (3) Precedence = UI key first, STK-072 env keys as fallback.
- "như recotdin" — Ming referred to how Ricotdin handles keys (spec §9 Q6); the chosen UI is the Settings card above.
- Spec/CLAUDE.md conflict flagged: both currently say LLM keys live only in the deploy repo's env handling. Ming's decision above overrides; this ticket updates both.
- 2026-11-10 (orchestrator): split per plan.md. This ticket is slice (a): Vault storage, migration/rollback/db:check stub, repo, key resolver (UI → env → off), AiClient per-call resolution, web/worker wiring, r3-guard, ADR 0009, CLAUDE.md and spec §7. The Settings card and actions (AC1, AC3, no-echo part of AC7) moved to STK-076.
