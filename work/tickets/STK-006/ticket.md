# STK-006: Server data layer for ledger, assets, settings

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | db, security |
| Attempts | 0 |
| Created | 2026-10-22 |

## Goal
Server-only repositories give the web app and worker one safe way to read and write transactions, corporate actions, assets, settings and watchlist, using the service role behind the auth helper, with all calculation left to `packages/core`.

## Spec reference
docs/spec-v1.md §4.1 Services, §4.2 Auth integration, §5 Data model. CLAUDE.md R1, R3, R6.

## Acceptance criteria
- [ ] Repositories for `transactions`, `corporate_actions`, `assets`, `settings`, `watchlist` (list/get/create/update/delete as needed) use the STK-003 row↔core mappers; no raw rows leak to callers.
- [ ] The Supabase service-role client lives in a server-only module (`server-only` import or equivalent); a check proves it is not in any client bundle and no `NEXT_PUBLIC_*` key holds it (R3).
- [ ] Every web entry point into the data layer calls the STK-004 auth helper first (R6); an unauthenticated or non-allowlisted call performs no query.
- [ ] A ledger read function loads transactions + corporate actions + settings and returns the result of `packages/core` `buildLedger`; no cost/P&L/quantity math outside core (R1).
- [ ] Unit tests with a mocked Supabase client cover mapping, ordering of same-day trades, and the auth-before-query rule.

## Notes / answers from Ming
- Depends on: STK-003 (schema + mappers). STK-004 is on hold and R6 is suspended (CLAUDE.md), so the auth criterion above is waived for now; keep entry points server-only.
- Input needed: none.
