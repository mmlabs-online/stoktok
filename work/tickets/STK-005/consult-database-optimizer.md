# consult-database-optimizer — STK-005

**STK-005 db consult (read-only). No migration needed.**

## Findings
- `prices_daily` has PK (symbol, trade_date). It has CHECKs: low<=high, open and close within [low, high], volume>=0, symbol regex. `open/high/low/close` are `integer` (R2 OK). `source` and `fetched_at` are NOT NULL (R4 OK).
- `data_gaps` has an identity PK, `symbol` nullable, `data_type`, `from_ts`/`to_ts` (timestamptz), `detected_at`, `source`, `fetched_at` and `resolved_at`. It has **no unique key**, only an index on (symbol, from_ts). So `upsert` with `onConflict` cannot be used for gaps. Dedupe has to be read-then-insert. That is acceptable for a single worker.
- `settings.holidays date[]` already exists, so the configurable holiday list (R5) needs no schema work.
- RLS and grants: service_role has full CRUD on both tables, so nothing to add.
- `packages/db/test/fake-client.ts` only whitelists `select, eq, gte, lte, order, limit, range, insert, update, upsert, delete, single, maybeSingle`. Gap queries need `is` and `in`, so add them to `METHODS`. This is a test-helper change only.
- Existing repos use `unwrap`, `fetchAll` and `mapRow`. The new repos should follow the same pattern (ctx `{table, op}`).

## Recommendations

**1. Idempotent upsert.**
- Use `db.from('prices_daily').upsert(rows, { onConflict: 'symbol,trade_date' })`.
- Do not chain `.select()`. That keeps returning=minimal, so no `max_rows` cap and a small response. Use `unwrap` on the result, but note that `unwrap` throws on `data === null`. A plain upsert returns `data: null`, so check `res.error` directly or add a small helper.
- **`fetched_at` should be updated** (plain DO UPDATE, not `ignoreDuplicates`):
  - R4 staleness logic reads `fetched_at`. Keeping an old value would make a re-verified row look stale.
  - Sources revise bars, for example a partial bar fetched before the close or an adjusted price. DO NOTHING would freeze the wrong value.
  - "Re-running changes nothing" should mean the stored OHLCV, volume and source are identical and no rows are added. `fetched_at` is provenance of the latest fetch. Tests should assert exactly that.
- Optional stricter variant: the job reads the stored dates and upserts only missing or changed bars. That makes a re-run write nothing, but it costs one more read. I don't recommend it for v1.
- Dedupe rows by (symbol, trade_date) inside the repo, keeping the last. Otherwise Postgres raises 21000, "ON CONFLICT DO UPDATE cannot affect row a second time", for the whole batch.
- Validate in the adapter or core before writing: integer VND, `low<=high`, `open` and `close` within range. One row violating a CHECK (23514, mapped to `VALIDATION`) fails the entire chunk. Chunks are not atomic, but re-running is safe because the writes are idempotent.

**2. Batch size.**
- Chunk upserts at 500 rows (about 100 KB). That is well under the PostgREST body limits and is fine for a 1-year backfill (about 250 rows per symbol).
- Run chunks sequentially, not with `Promise.all`.
- Daily runs are normally 1 row per symbol. Collect all symbols into one upsert.
- Gap inserts and resolves: chunk at 200 (the `in()` list goes in the URL, so keep it short).

**3. `data_gaps` semantics (no migration).**
- Granularity: one row per missing trading day per symbol. The logical key is (symbol, data_type='prices_daily', from_ts). Use `from_ts = to_ts = ` that trade date at 00:00 Asia/Ho_Chi_Minh. Coalescing ranges would make resolve and dedupe harder.
- **Pitfall:** Postgres returns timestamptz as `...+00:00`, in a different format from what you sent. Compare keys by epoch ms (`Date.parse`), never by string equality. Otherwise re-runs will duplicate rows.
- Record gaps like this:
  1. Compute the expected trading days in the window. Use weekdays, minus `settings.holidays`, up to and including the last closed session.
  2. Read the stored dates with `listPriceDates`.
  3. The difference is the missing days. Read the open gaps (`resolved_at is null`, same symbol and data_type) and insert only the keys not already open.
  4. Do not touch existing open rows. `detected_at` stays at the first detection. `source` and `fetched_at` on a gap record the source and attempt time at detection, which satisfies R4.
- Resolve: after the upsert, run `update data_gaps set resolved_at=<now> where symbol=? and data_type=? and resolved_at is null and from_ts in (dates now stored)`. Never delete gaps. A day that goes missing again after resolution produces a new row, because the existence check only looks at open rows.
- Bound the lookback window. This matters most for a newly added watchlist symbol or a recent listing. Scanning a year back would create hundreds of false gaps. Use a configurable lookback (for example 30 days), or start at the first stored or fetched date for the symbol.
- Do not generate gaps for today until after the close and the sync window. Also skip any day where the source returned nothing at all for every symbol, since that is likely a market-wide issue. Record it as a single `symbol = NULL` gap or log it. Planner's call.

**4. Repo functions to add** (in `packages/db/src/repos/prices-daily.ts` and a new `data-gaps.ts`, exported from `index.ts`):
- `upsertPricesDaily(db, rows, { chunkSize = 500 }): Promise<number>` — dedupes, chunks, and returns the count written.
- `listPriceDates(db, symbol, from, to): Promise<string[]>` — `fetchAll` with `select('trade_date')`, `eq`, `gte`, `lte`, `order('trade_date')`, `range`.
- `listOpenGaps(db, { dataType, symbol? }): Promise<Gap[]>` — `fetchAll` with `eq`, `is('resolved_at', null)`, `order('id')`.
- `recordGaps(db, gaps): Promise<number>` — reads the open gaps, inserts only the missing keys (chunked), and returns the inserted count.
- `resolveGaps(db, { symbol, dataType, fromTs[], resolvedAt }): Promise<void>` — `update` with `eq`, `eq`, `is`, `in`, chunked.

**Fake-client tests** (extend `METHODS` with `is`, `in`):
- Upsert:
  - Asserts `onConflict: 'symbol,trade_date'` and that the row shape includes `source` and `fetched_at`.
  - 1200 rows give 3 upsert calls (500, 500, 200).
  - Duplicate keys in the input are deduped.
  - Empty input makes no call.
  - An error with code `23514` gives `VALIDATION`; any other error gives `DB_ERROR`.
  - A second call with identical input sends an identical payload apart from `fetched_at`.
- `listPriceDates` pages correctly: a full page triggers a second `range`.
- `recordGaps`:
  - Skips keys that are already open, including when the stored string is `+00:00` and the new one is `Z` or `+07:00`.
  - Inserts only the new ones.
  - Makes no insert call when nothing is new.
  - A second identical run inserts zero rows.
- `resolveGaps`: asserts the `is('resolved_at', null)` and `in('from_ts', ...)` calls and chunking; an empty list makes no call.

**5. `getLatestCloses` one query per symbol.** Fine for a personal watchlist (tens of symbols, `Promise.all`, indexed by PK prefix). Avoiding it would need a view or RPC, which means a migration, so don't. If the watchlist ever exceeds roughly 100 symbols, cap concurrency. For the job's "from date", `getLatestCloses` gives the latest stored date, which is enough to choose the fetch start. It does not reveal interior gaps, so gap detection must use `listPriceDates`.

## Risks
- Gap dedupe is read-then-insert, so two concurrent worker runs (cron overlap plus a manual run) could duplicate gaps. Mitigate with a single-run lock in the worker. A partial unique index on `(symbol, data_type, from_ts) where resolved_at is null` would be race-proof. It is optional hardening and is a migration, so make it a follow-up (R7). If added, use insert and handle `23505` as `CONFLICT`. Supabase `onConflict` can't target a partial index.
- The timestamptz string-format mismatch (see above) is the most likely bug.
- A partial bar fetched before the close, and then overwritten later, relies on the DO UPDATE behavior. This is another reason not to use `ignoreDuplicates`.
- Chunked writes are not atomic. A mid-run failure leaves some rows written, which is safe because the writes are idempotent.

## Open questions
- Should `fetched_at` on re-run be refreshed (recommended) or kept?
- Lookback window default (suggest 30 days), and whether a market-wide empty response is a `symbol = NULL` gap.
- Should a unique partial index on `data_gaps` be done now or deferred as a follow-up?

Files read: `/home/user/stoktok/supabase/migrations/20261023000100_v1_tables.sql`, `/home/user/stoktok/supabase/migrations/20261023000200_v1_rls_grants.sql`, `/home/user/stoktok/packages/db/src/repos/prices-daily.ts` and its test, `/home/user/stoktok/packages/db/src/errors.ts`, `/home/user/stoktok/packages/db/test/fake-client.ts`, `/home/user/stoktok/packages/db/src/repos/corporate-actions.ts`.
