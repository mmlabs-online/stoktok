# STK-003: Supabase schema and migrations for v1.0 data

| Field | Value |
|---|---|
| State | DONE |
| Priority | P1 |
| Areas | db, security |
| Attempts | 1 |
| Created | 2026-10-22 |

## Goal
Create the stoktok database schema for v1.0 as Supabase migrations, aligned with the `packages/core` ledger types from STK-002, so later tickets can persist transactions, assets, watchlist, settings and daily prices.

## Spec reference
docs/spec-v1.md §5 Data model, §2.1 market rules (as settings), §4.2 Auth integration (server-only DB access), §10 Roadmap v1.0. Input from STK-002: `work/tickets/STK-002/consult-database-optimizer.md`.

## Acceptance criteria
- [ ] Migrations under `supabase/migrations/` create v1.0 tables: `transactions`, `corporate_actions`, `assets`, `watchlist`, `settings`, `prices_daily`, `data_gaps`.
- [ ] All money columns (amounts, fees, tax, totals, `amount_per_share`) are `bigint` VND; `quantity` and price columns are integer types; no `numeric`/float money columns (R2).
- [ ] `corporate_actions` stores `ex_date`, `record_date`, `pay_date`, `listing_date`, `amount_per_share`, `ratio_num`, `ratio_den`, matching the core `CorporateAction` input; `transactions` has a stable ordering key for same-day trades.
- [ ] `prices_daily` and `data_gaps` carry `source` and `fetched_at` (R4); `settings` stores rates in the same unit core uses (ppm) and `cash_dividend_treatment`.
- [ ] RLS is enabled on every table with **no** policies for `anon` or `authenticated` — access is server-side via service role only (R3). A check verifies this (SQL test or script).
- [ ] Migrations apply cleanly from empty (`supabase db reset` or equivalent), and the check runs via a documented `pnpm` script.
- [ ] Row ↔ core type mapping functions (snake_case rows ↔ core types, `bigint` handled safely) with unit tests.

## Notes / answers from Ming
- Spec §5 lists a `lots` table, but STK-002 derives lots from transactions in core. Planner: propose whether `lots` is stored or derived; if the plan diverges from the spec, say so explicitly for Ming.
- Signals, suggestions, news, intraday prices and financials tables are **out of scope** (later tickets).
