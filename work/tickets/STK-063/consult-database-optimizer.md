# STK-063 consult — database-optimizer (read-only)

## Findings
- Migration pattern (supabase/migrations/20261108000200_news.sql): `public.<table>`, `bigint generated always as identity`, inline CHECKs, `comment on`, then `enable row level security; revoke all ... from public, anon, authenticated; grant select, insert, update, delete ... to service_role`. RLS and grants go in the table's own migration (the 20261023000200 grants loop only covers tables that existed then). There are no policies, so service_role (which bypasses RLS) is the only access.
- Rollback pattern: supabase/rollback/<same timestamp>_<name>.down.sql, containing `drop table if exists public.<t>;`.
- The latest migration timestamp is 20261108000200, so use something like `20261109000100_ai_usage.sql`.
- scripts/db-check/checks.sql line 34 asserts an exact sorted table list (15 tables). It needs `ai_usage` added. It also needs column asserts, a service_role read/write check, a negative-constraint check, and a check that anon/authenticated are denied. Otherwise `pnpm db:check` fails on the table count.
- Spec §5 has no AI table, so this is a new table. Spec §2 and §6 do not specify a budget. The ticket is the only source.

## Recommendations
**Schema** (AC2, R2, R4):
```sql
create table public.ai_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  provider text not null check (provider in ('anthropic','google')),
  model text not null check (model <> ''),
  task text not null check (task in ('chat','summary','explanation')),  -- or a looser char_length check, since the task list is config (R5)
  status text not null check (status in ('reserved','completed','failed','refused')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_micro_usd bigint not null check (cost_micro_usd >= 0),
  reserved_micro_usd bigint not null default 0 check (reserved_micro_usd >= 0),
  error text check (char_length(error) <= 500)
);
create index ai_usage_created_at_idx on public.ai_usage (created_at);
```
- Money is integer micro-USD. 5 USD = 5,000,000, so use `bigint` for the cost columns and plain `integer` for tokens (a single call stays far below 2^31 tokens). Never use float or numeric. Rounding (ceil per call, to stay conservative) lives once in `packages/core` or the AI package's cost function and has unit tests.
- Price table and model-per-task are config and are not stored in the DB (R5). Optionally store `price_version text` on the row for audit.
- Do not add `task` or `provider` CHECK lists that duplicate config in a way that blocks adding a model. A provider CHECK is fine, since there are exactly two. For `task`, prefer `char_length between 1 and 50`.
- The rows hold no prompt text, which keeps them free of untrusted data and PII.

**Month-to-date sum in Asia/Ho_Chi_Minh:**
- Do not index on an expression such as `date_trunc('month', created_at at time zone ...)`. `timestamptz at time zone` is immutable only with a constant zone literal, which is fragile.
- Compute the month bounds in the app (or inside the SQL function) as `[start_of_month_ICT, start_of_next_month_ICT)`, converted to UTC instants. Vietnam has no DST and a fixed +07:00, so this is stable. Then run `select coalesce(sum(greatest(cost_micro_usd, reserved_micro_usd)),0) from ai_usage where created_at >= $1 and created_at < $2` and use the plain btree on `created_at`. Month rollover is then a pure function of "now" and is easy to unit test (e.g. 2026-11-30T17:00:00Z is already 2026-12-01 in ICT).
- A single-user app produces at most a few thousand rows a month, so no partitioning, materialized view or rollup is needed. A range scan is enough.
- Store `created_at` as UTC `timestamptz` and never store the month as a separate key.

**Concurrency / atomic budget gate** (AC3):
- The worker, the web server and STK-064/065/066 can all call concurrently. A read-then-call check (sum, compare, call, insert) can overspend: N parallel calls each see headroom. A hard cap needs a reservation.
- Recommended: a Postgres function `public.ai_reserve(provider, model, task, worst_case_micro_usd, cap_micro_usd, month_start, month_end) returns bigint` (security definer is not needed; grant execute to service_role only, `revoke execute ... from public`). Inside it:
  1. `pg_advisory_xact_lock(hashtext('ai_budget'))`, which serialises the check (cheap here, one user).
  2. Sum `greatest(cost, reserved)` over the month window.
  3. If `sum + worst_case > cap`, insert a `refused` row (0 cost) and return null.
  4. Otherwise insert a `reserved` row with `reserved_micro_usd = worst_case` and return its id.
- After the provider responds, `update ai_usage set status='completed', input_tokens=..., output_tokens=..., cost_micro_usd=actual, reserved_micro_usd=0 where id=$1`. On failure, update to `failed` and set cost to what was actually billed (0 if the request never reached the provider).
- Crashed calls leave stale `reserved` rows that count against the budget (fail-safe). Add a reaper: rows with `status='reserved'` older than e.g. 15 min are treated as `failed` with cost = reserved, or released. Pick one policy explicitly. Counting the reserved amount is the safest for a hard cap.
- Keep the 80% warning and the 100% refusal as pure functions in core, fed by the sum. The cap compare happens in SQL for atomicity, with the cap passed in from config. The warning level can be computed in app code from a read-only sum.
- If a Postgres function feels too heavy for the plan, the minimum acceptable alternative is a single-process in-memory mutex plus the reservation row. That is not safe across web and worker processes, so I advise against it as the only guard.
- The function needs its own entry in the rollback (`drop function if exists ...` before `drop table`) and db-check cases: under cap, at cap, over cap, and two sequential reservations that together exceed it.

**RLS:** copy the news pattern exactly. Add the `revoke execute on function ... from public, anon, authenticated` plus `grant execute ... to service_role`, since functions are executable by public by default.

**Rollback:** `drop function if exists public.ai_reserve(...); drop table if exists public.ai_usage;`. Check that the db:check "0 tables after rollback" step still passes.

## Risks
- Worst-case estimate too high (max_tokens x output price + input estimate) refuses calls early near the cap. This is acceptable, but document it and set max_tokens per task in config.
- A stale price table makes cost drift from the real bill. Add a unit test on the price config shape and note that prices must be re-verified.
- A refused-call log row at 100% can spam the table. This is harmless at this volume, but consider not logging repeated refusals.
- If the plan skips atomicity, the "hard cap" claim is false under concurrency (web chat plus the worker's summary job).
- Without updating checks.sql, `pnpm db:check` (the table list assert) breaks.
- Clock source: use the DB `now()` for `created_at` and compute the month window from a single "now" per call to avoid boundary races between the app and the DB.

## Open questions
1. Reservation function in Postgres (recommended) or app-level only? That is a planner decision with a security implication, so confirm with the architect.
2. Policy for stale `reserved` rows: count as spent (recommended) or release after a timeout?
3. Are failed or invalid-schema calls billed? Provider tokens are billed even if zod validation fails (R9), so those rows should keep their real cost and use a status like `invalid_output`. Add that status value, or log it in `error`.
4. Is `task` a closed enum (chat, summary, explanation) or open? STK-064 to 066 may add tasks.
5. Should rows link to a caller entity (e.g. `suggestion_id` or `news_id`) for R9 citation tracing? There is no FK target yet, so I recommend leaving it out and adding it in a later ticket.

Relevant files:
- /home/user/stoktok/work/tickets/STK-063/ticket.md
- /home/user/stoktok/supabase/migrations/20261108000200_news.sql
- /home/user/stoktok/supabase/rollback/20261108000200_news.down.sql
- /home/user/stoktok/supabase/README.md
- /home/user/stoktok/scripts/db-check/checks.sql
