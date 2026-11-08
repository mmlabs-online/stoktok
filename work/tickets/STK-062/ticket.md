# STK-062: News adapters (CafeF, Vietstock, VnExpress) and news store

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | data, db, security |
| Attempts | 0 |
| Created | 2026-11-08 |
| PR | — |

## Goal
Fetch financial news for the market and for watchlist and holding symbols from CafeF, Vietstock and VnExpress Kinh doanh, and store it with source and credibility. The AI summaries and the chat agent use this as input.

## Spec reference
docs/spec-v1.md §3 F5 (news collection, credibility tag), §4 `NewsSource`, §5 `news`, §7 schedule (hourly on trading days); open question 5. CLAUDE.md R4.

## Acceptance criteria
- [ ] Each of the 3 sources sits behind `NewsSource`. Use RSS wherever it is available. The plan records each site's robots.txt and terms check, and a source that does not allow fetching is left out.
- [ ] A `news` table stores id, title, url (unique), source, published_at, fetched_at, credibility (official disclosure > established outlet), linked symbols, and a plain-text excerpt or body capped at a configured length. Migration with RLS on, service_role only, and a rollback file.
- [ ] Symbol linking is deterministic code in `packages/core` (ticker match with word boundaries, plus a company-name alias list) with unit tests. No LLM is used for linking.
- [ ] A worker job runs hourly on trading days, de-duplicates by url, and respects per-source rate limits from config (R5). A source failure is recorded as a gap and does not stop the other sources.
- [ ] Stored article text is treated as untrusted data: HTML is stripped, the text is stored as plain text, and nothing from it is ever executed or rendered as HTML.
- [ ] `typecheck`, `lint` and `test` are green, with recorded RSS fixtures for each source.

## Notes / answers from Ming
- 2026-11-08: Sources CafeF, Vietstock, VnExpress Kinh doanh approved, after a terms check.
