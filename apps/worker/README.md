# @stoktok/worker

## End-of-day price sync (`eod-prices`)

Fetches daily OHLCV for watchlist and held symbols from the TCBS public API and upserts `prices_daily` (idempotent; `source` and `fetched_at` on every row). See `docs/adr/0001-eod-price-source.md`.

```
pnpm worker:eod              # fetch and write
pnpm worker:eod --dry-run    # fetch and validate, write nothing
```

Env, in `apps/worker/.env.local` (git-ignored, loaded with `node --env-file-if-exists`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. The service role key is server-only (R3).

**First live run: use `--dry-run` and check that the closes look like VND** (VNM is tens of thousands, not tens). The unit, raw-vs-adjusted prices and the date encoding are unverified; wrong units are rejected by the plausibility guards (see `rejectedBySymbol` in the summary) instead of stored.

Output: one JSON summary line on stdout (logs go to stderr). Exit code: 0 ok; 1 partial or failed run (a symbol failed or was skipped, a bar was rejected, the ledger could not be read, or a fatal error); 2 usage error.

Tuning (lookback, delay, retries) is in `src/config.ts`.

### Scheduling (documented only, no scheduler code)

Use `TZ=Asia/Ho_Chi_Minh`. Run after the 18:00 price cutoff so the target date is today, plus a catch-up run:

```
TZ=Asia/Ho_Chi_Minh
30 18 * * 1-5 cd <repo> && pnpm worker:eod
0 21 * * 1-5 cd <repo> && pnpm worker:eod
```

Container form (compose belongs to STK-017/018): `docker compose run --rm worker node dist/cli.js eod-prices`.

A run on a non-trading day or before the cutoff re-syncs up to the previous trading day, which is harmless. The window is the last 20 trading days, so a missed day is picked up by the next run.

### Holidays

Holidays come from `settings.holidays`. They only shift the target date and the fetch window; an incomplete list cannot corrupt prices. Keep it current.

## Financials sync (`financials`)

Fetches quarterly EPS, BVPS, revenue and net income plus a sector label for watchlist and held symbols from the TCBS public API. It upserts `financials` (idempotent; `source` and `fetched_at` on every row), records missing quarters in `data_gaps` (never filled) and writes `symbols.sector`. See `docs/adr/0002-financials-source.md`.

```
pnpm worker:financials              # fetch and write
pnpm worker:financials --dry-run    # fetch and validate, write nothing
```

Env as for the EOD sync. **First live run: use `--dry-run` and check** that EPS is in the thousands of VND, BVPS is above 100 VND, revenue is in billions of VND (stored as integer VND) and which EPS basis the source uses (quarterly vs TTM; this is unverified). Wrong units are rejected (see `rejectedBySymbol`) instead of stored; `missingPeriods` is reported on dry-run too.

Output: one JSON summary line on stdout (logs on stderr). Exit code: 0 ok; 1 partial or failed run (a symbol failed or was skipped, a period was rejected, the sector fetch failed, the ledger could not be read, or a fatal error); 2 usage error. Symbols with no data (ETFs) do not fail the run.

Schedule (documented only), after the EOD sync:

```
TZ=Asia/Ho_Chi_Minh
45 18 * * 1-5 cd <repo> && pnpm worker:financials
```

Tuning (lookback, publish lag, delay, caps) is in `src/config.ts`.
