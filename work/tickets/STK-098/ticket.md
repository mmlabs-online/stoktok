# STK-098: Owner-role test:db hardening (STK-090 follow-ups)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P3 |
| Areas | security, db |
| Attempts | 0 |
| Created | 2026-11-18 |
| PR | — |

## Goal
Follow-ups from STK-090's security reviews (attempt 1 🟡2–🟡4, attempt 2 residual note) and code review (attempt 1 doc note). Test-harness hardening only; no production impact.

Scope:
- 🟡2: send a SCRAM-SHA-256 verifier computed in Node (`password 'SCRAM-SHA-256$4096:…'`) instead of the plaintext derived hex in `create/alter role`, so server logs never show it.
- 🟡3: pre-flight refusal in test:db when the cluster looks like a non-test server (e.g. `stoktok` / `org_admin` databases or roles present), mirroring db:check; document `drop role stoktok_test_owner` as manual cleanup; decide: refuse a password-less admin URL, or give the owner a random password.
- 🟡4: in `owner.test.ts`, create the membership test role inside the `try` so a failed `grant` cannot leak it.
- Residual: include `pg_db_role_setting` rows for the owner (`setrole in (0, owner oid)`) in the fail-closed check, or document why they cannot reach test databases.
- Docs: note in `scripts/db-check.sh` / `db/migrations/README.md` that URL-mode db:check permanently revokes PUBLIC CONNECT on `postgres`.

## Spec reference
ADR 0010 §12; work/tickets/STK-090/security-review.md, review.md.

## Acceptance criteria
- [ ] Each item has a test or a documented decision.
- [ ] typecheck, lint, test, test:db, db:check green (test:db → db:check → test:db on one server).

## Notes / answers from Ming
- 2026-11-18 (orchestrator): created from STK-090 reviews.
