Status: READY

# Plan — STK-053: Vietlott schema and server data layer

## Spec summary
docs/spec-v1.md §3 F8 Vietlott tracker:
> Personal record of Vietlott tickets Ming buys elsewhere (Vietlott SMS, MoMo). **Games: Mega 6/45 and Power 6/55 only**; Max 3D, Lotto 5/35 and Keno are out of scope.
> - **Ticket ledger**: game, draw number, numbers (regular and system/"bao" tickets), cost, purchase channel (`sms` / `momo`), purchased_at, status (`pending` / `lost` / `won` + prize tier). Entry by pasting the Vietlott SMS confirmation (parsed) or quick manual entry (MoMo has no API).
> - **Results and checking**: the worker fetches each draw's result (with `source` and `fetched_at`, R4), checks pending tickets, and the app shows wins in-app (no push).

§1.3 Non-goals: "No order placement of any kind (this includes Vietlott tickets: F8 only records tickets bought elsewhere)." §10: "v1.3 | F8 Vietlott tracker (Mega 6/45, Power 6/55)".

CLAUDE.md rules that apply: R1 (no prize/tax maths in the repo or UI; core owns it), R2 (bigint integer VND), R3 (service_role only, browser never reads), R4 (`source` + `fetched_at` NOT NULL on draws), R5 (game rules such as number ranges and bao sizes stay in core config, not SQL), R6 (requireUser at entry points), R8 (green checks, core tests).

This ticket covers **only** the schema and the `packages/db` data layer. Out of scope, with their own tickets: the draw adapter and checking job (STK-054), the screen, manual entry form, web handlers and server actions (STK-055), the SMS parser (STK-056), suggestions, statistics and opportunity cost (STK-057..059).

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | The migration adds `lottery_draws` (game, draw number, draw date, numbers, bonus, jackpot amounts, `source`, `fetched_at`) and `lottery_tickets` (game, draw number, numbers, system size, cost, channel `sms`/`momo`/`manual`, purchased_at, status, prize tier, prize amounts, raw input text). | Read `supabase/migrations/20261106000100_lottery.sql`. `pnpm db:check` passes. Its new blocks are `tables_exist` (which now lists both tables), `money_columns_bigint` (`jackpot_vnd`, `jackpot2_vnd`, `cost_vnd`, `gross_vnd`), `source_fetched_at_not_null` (draws), `lottery_columns`, `service_role_can_read_write_lottery_draws` and `service_role_can_read_write_lottery_tickets`. The rollback file `supabase/rollback/20261106000100_lottery.down.sql` exists. "System size" is not a column: it is the length of each line in `lines` (see Assumptions A5). |
| 2 | RLS is on for both tables, matching existing tables, and the browser never reads them directly (R3). | The migration has `enable row level security`, `revoke all ... from public, anon, authenticated` and `grant select, insert, update, delete ... to service_role` for both tables, and no policies. `pnpm db:check` runs `rls_enabled_all_tables`, `no_policies`, `no_grants_anon_authenticated_public` and the `anon_denied` / `authenticated_denied` loops, which pick up the new tables automatically. `packages/db/src/r3-guard.test.ts` stays green, so no `'use client'` file imports the db layer. |
| 3 | Unique keys: one draw row per (game, draw number). Duplicate SMS imports are detected (same raw text, or same game + draw + numbers + purchased_at). | Primary key `(game, draw_no)` on `lottery_draws`. Partial unique indexes `lottery_tickets_raw_text_uidx` and `lottery_tickets_sms_identity_uidx` on `lottery_tickets`. `checks.sql` `lottery_duplicates` block: a second draw with the same (game, draw_no) fails with 23505; re-pasted raw text with different whitespace fails with 23505; an SMS row with the same identity fails with 23505; a `manual` row with the same identity succeeds; two rows with null raw_text succeed. In vitest, `lottery.test.ts › createLotteryTicket maps 23505 to CONFLICT` and `› createLotteryTicket canonicalises lines before insert`. |
| 4 | Server data functions call `requireUser()` (R6) and are covered by tests in the same style as existing data-layer tests. | The repos follow the existing convention: each file's doc comment says "Callers must call requireUser() first (R6)", as `assets/handlers.ts`, `load-watchlist.ts` and `server/db.ts` do. `apps/web/test/entrypoints.test.ts` stays green; it enforces requireUser in every page and server action. This ticket adds no page or action (see A1). `pnpm --filter @stoktok/db test` runs `packages/db/src/repos/lottery.test.ts`, which uses `createFake()` like the other repo tests. |
| 5 | `typecheck`, `lint`, `test` green. | `pnpm typecheck && pnpm lint && pnpm test`, plus `pnpm db:check` (CI runs it in `.github/workflows/ci.yml`). |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `supabase/migrations/20261106000100_lottery.sql` | **Create.** Both tables, their checks, indexes, RLS, revoke and grants. | AC 1–3 |
| `supabase/rollback/20261106000100_lottery.down.sql` | **Create.** `drop table if exists public.lottery_tickets;` then `drop table if exists public.lottery_draws;` | Every migration in the repo has a rollback |
| `scripts/db-check/checks.sql` | **Modify.** Add both tables to the `tables_exist` array, add `assert_col` lines, add the `service_role_can_read_write_lottery_*` and `lottery_columns` blocks, add bad-row cases and a `lottery_duplicates` block. | `tables_exist` is an exact list, so db:check fails without this. The schema tests for AC 1–3 also live here. |
| `packages/core/src/lottery/canonical.ts` | **Create.** `canonicalTicketLines(lines: number[][]): number[][]` sorts the numbers in each line ascending, then sorts the lines (shorter line first, then numeric lexicographic). It does no validation. | The identity unique key compares `lines` exactly, so it only works on canonical input (consult §1, Risks). This is domain logic, so it goes in core. |
| `packages/core/src/lottery/canonical.test.ts` | **Create.** Unit tests for the function above. | R8 |
| `packages/core/src/lottery/index.ts` | **Modify.** Export `canonicalTicketLines`. | Public API |
| `packages/db/src/rows.ts` | **Modify.** Add `LotteryDrawRow`, `LotteryDrawInsert`, `LotteryTicketRow` and `LotteryTicketInsert`. | Repo row types, following the existing convention |
| `packages/db/src/mappers.ts` | **Modify.** Add `drawIdFromNo` and `drawNoFromId`, `lotteryDrawFromRow` and `lotteryDrawToRow` (pools ↔ columns), `lotteryTicketFromRow` and `lotteryTicketToRow`, and the `StoredLotteryTicket` and `LotteryTicketInput` types. | Bigint strings become numbers (R2), the drawId format is defined once, and pools map to tiers |
| `packages/db/src/repos/lottery.ts` | **Create.** Draws: `upsertLotteryDraws` and `getLotteryDraw`. Tickets: `createLotteryTicket`, `listLotteryTickets`, `getLotteryTicket`, `updateLotteryTicket`, `recordLotteryTicketResult` and `listPendingLotteryTickets`. | Ticket goal: create, list and update tickets. The draw read and write are needed by STK-054 and STK-055. |
| `packages/db/src/repos/lottery.test.ts` | **Create.** Fake-client tests (listed below). | AC 4, R8 |
| `packages/db/src/index.ts` | **Modify.** Export the new repo functions and types. | `apps/web/server/db.ts` re-exports `@stoktok/db`, and the worker imports it |

The implementer must not touch any other file without recording why in impl-log.md. This ticket does not touch `apps/web` or `apps/worker`.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `canonical.test.ts › sorts numbers inside each line` | canonical form |
| `canonical.test.ts › sorts lines: shorter first, then numerically (not as strings: [2,…] before [10,…])` | canonical form, the string-sort trap |
| `canonical.test.ts › same ticket in a different order gives deep-equal output` | the identity duplicate rule |
| `canonical.test.ts › does not mutate the input` | purity |
| `canonical.test.ts › mixed regular (6) and bao (8) lines are kept` | mixed sizes |
| `lottery.test.ts › drawIdFromNo / drawNoFromId round-trip; '00123' → 123; '0', '-1', '1.5', 'abc', '' are rejected` | drawId format (A4) |
| `lottery.test.ts › lotteryDrawFromRow maps a mega row: smallint numbers, bigint-string jackpot_vnd '12000000000' → pools.jackpot, no bonus` | mapper, R2 |
| `lottery.test.ts › lotteryDrawFromRow maps a power row: bonus, jackpot_* → jackpot1, jackpot2_* → jackpot2; null pool columns → pools omitted` | mapper, tier mapping |
| `lottery.test.ts › lotteryDrawFromRow: missing source or fetched_at → MAPPING (R4); unknown game → MAPPING` | R4 |
| `lottery.test.ts › upsertLotteryDraws uses onConflict 'game,draw_no', dedupes the input (last wins) and chunks` | upsert |
| `lottery.test.ts › getLotteryDraw filters game and draw_no with maybeSingle; no row → NOT_FOUND` | read |
| `lottery.test.ts › createLotteryTicket canonicalises lines before insert` (asserts the `insert` payload) | AC 3 |
| `lottery.test.ts › createLotteryTicket maps 23505 to CONFLICT` | AC 3 |
| `lottery.test.ts › createLotteryTicket maps cost_vnd/gross_vnd bigint strings to numbers` | R2 |
| `lottery.test.ts › listLotteryTickets: optional game/status/drawId filters become eq; order purchased_at desc, id asc` | list |
| `lottery.test.ts › lotteryTicketFromRow: lines that are not an array of integer arrays → MAPPING; bad status/channel/prize_tier → MAPPING` | mapper safety |
| `lottery.test.ts › updateLotteryTicket sends the edited fields with status 'pending' and null result columns; no row → NOT_FOUND` | update (A7) |
| `lottery.test.ts › recordLotteryTicketResult: won writes prize_tier and gross_vnd plus checked_at; lost writes gross_vnd 0 and prize_tier null; no row → NOT_FOUND` | result update |
| `lottery.test.ts › listPendingLotteryTickets filters status 'pending', game, draw_no` | worker query |
| `checks.sql › lottery_columns, service_role_can_read_write_lottery_draws, service_role_can_read_write_lottery_tickets, lottery_duplicates` + `rejects_bad_rows` cases (listed in Approach step 2) | AC 1–3 |

## Approach
1. **Migration** `20261106000100_lottery.sql`. Use the style of `20261105000200_prices_intraday.sql` and add a header comment saying RLS and grants are in this file.

   `lottery_draws`:
   - `game text not null check (game in ('mega645','power655'))`
   - `draw_no integer not null check (draw_no > 0)`
   - `draw_date date not null`
   - `numbers smallint[] not null`
   - `bonus smallint`
   - `jackpot_vnd bigint`, `jackpot_winners integer`
   - `jackpot2_vnd bigint`, `jackpot2_winners integer`
   - `source text not null check (source <> '')`, `fetched_at timestamptz not null`
   - `created_at timestamptz not null default now()`
   - `primary key (game, draw_no)`

   Checks on `lottery_draws`:
   - `cardinality(numbers) = 6`, `array_position(numbers, null) is null`, and `1 <= all(numbers) and 55 >= all(numbers)`. This bound is deliberately loose; core `validateDrawResult` is strict per game (R5).
   - `(game = 'power655') = (bonus is not null)`, and `bonus is null or bonus between 1 and 55`.
   - `jackpot_vnd` and `jackpot_winners` are both null or both set, each >= 0. The same rule applies to `jackpot2_*`.
   - `game = 'power655' or (jackpot2_vnd is null and jackpot2_winners is null)`.
   - Column comments: `jackpot_*` holds tier `jackpot` for mega645 and `jackpot1` for power655; `jackpot2_*` holds power655 `jackpot2` only. Amounts are integer VND (R2).

   `lottery_tickets`:
   - `id uuid primary key default gen_random_uuid()`
   - `game` (same check as draws), `draw_no integer not null check (draw_no > 0)`
   - `lines jsonb not null`, checked by `jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 50 and pg_column_size(lines) <= 8192`
   - `cost_vnd bigint not null check (cost_vnd >= 0)`
   - `channel text not null check (channel in ('sms','momo','manual'))`
   - `purchased_at timestamptz not null`
   - `status text not null default 'pending' check (status in ('pending','won','lost'))`
   - `prize_tier text check (prize_tier in ('jackpot','jackpot1','jackpot2','first','second','third'))`
   - `gross_vnd bigint check (gross_vnd >= 0)`
   - `checked_at timestamptz`
   - `raw_text text check (raw_text is null or char_length(raw_text) between 1 and 2000)`
   - `created_at timestamptz not null default now()`

   Status shape check, `lottery_tickets_status_shape`:
   - `pending`: `prize_tier`, `gross_vnd` and `checked_at` are all null.
   - `lost`: `prize_tier` is null, `gross_vnd = 0`, and `checked_at` is not null.
   - `won`: `prize_tier` is not null, `gross_vnd > 0`, and `checked_at` is not null.

   No foreign key from tickets to draws, because a ticket is entered before its draw exists (consult §3).

   Indexes:
   - `create unique index lottery_tickets_raw_text_uidx on public.lottery_tickets (md5(regexp_replace(btrim(raw_text), '\s+', ' ', 'g'))) where raw_text is not null;` The raw text is stored verbatim; whitespace is normalised only for the uniqueness key.
   - `create unique index lottery_tickets_sms_identity_uidx on public.lottery_tickets (game, draw_no, purchased_at, md5(lines::text)) where channel = 'sms';` The `md5` keeps the index row small. A plain jsonb key could exceed the ~2.7 kB btree row limit on large bao tickets.
   - `create index lottery_tickets_pending_idx on public.lottery_tickets (game, draw_no) where status = 'pending';`
   - `create index lottery_tickets_game_purchased_idx on public.lottery_tickets (game, purchased_at desc);`

   RLS and grants for each table: `enable row level security`, `revoke all ... from public, anon, authenticated`, `grant select, insert, update, delete ... to service_role`. No policies. No sequences, so no sequence grants (R3).

2. **Rollback and checks.sql.**
   - Rollback drops tickets, then draws.
   - In `checks.sql`:
     - Insert `'lottery_draws','lottery_tickets'` into the `tables_exist` array, in alphabetical order after `financials`.
     - `money_columns_bigint`: assert `lottery_draws.jackpot_vnd`, `lottery_draws.jackpot2_vnd`, `lottery_tickets.cost_vnd` (not null) and `lottery_tickets.gross_vnd`.
     - `source_fetched_at_not_null`: assert both columns on `lottery_draws`.
     - `lottery_columns`: assert `lines` is jsonb not null, `numbers` is ARRAY not null, `draw_no` is integer not null on both tables, `purchased_at` is timestamptz not null, and `draw_date` is date not null.
     - `service_role_can_read_write_lottery_draws`: insert, then upsert on conflict, then confirm a count of 1 with the updated value, then delete.
     - `service_role_can_read_write_lottery_tickets`: insert pending, then update to won, then read, then delete.
   - `rejects_bad_rows` cases (all 23514 unless noted):
     - game `keno`
     - draw_no 0
     - 5 drawn numbers
     - drawn number 56
     - mega row with a bonus
     - power row without a bonus
     - jackpot_vnd without jackpot_winners
     - mega row with jackpot2_vnd set
     - draw with empty source
     - draw with null fetched_at (23502)
     - lines `'{}'` (an object)
     - lines `'[]'` (empty)
     - negative cost
     - channel `zalo`
     - status `won` with null gross_vnd
     - status `pending` with checked_at set
     - status `lost` with a prize_tier
     - raw_text `''`
     - raw_text longer than 2000 characters
   - `lottery_duplicates` block:
     - A duplicate (game, draw_no) draw fails with 23505.
     - The same raw_text with extra spaces and newlines fails with 23505.
     - An SMS row with the same identity and a different raw_text fails with 23505.
     - Two `manual` rows with the same identity and null raw_text both succeed.
   - Every block stays inside the outer transaction that the script rolls back.

3. **Core.** Add `canonicalTicketLines` in `packages/core/src/lottery/canonical.ts` with the tests listed above, and export it from `packages/core/src/lottery/index.ts`. It is a pure function and does not validate; `validateTicketLines` stays the validator.

4. **Rows and mappers** (`packages/db`).
   - `drawIdFromNo(n) = String(n)`.
   - `drawNoFromId(id)` accepts `/^\d+$/` with a value of at least 1 and returns `Number(id)`. Otherwise it throws `DataError('VALIDATION', ...)`, or a `RowMappingError` when the value came from a row.
   - Draw mapper:
     - Returns the core `DrawResult` plus `source` and `fetchedAt`, so R4 provenance is not lost. The return type is `StoredDrawResult = DrawResult & { source; fetchedAt }`, declared in mappers.
     - Maps the jackpot columns to tier ids by game. `jackpot` goes to mega645 `jackpot` and power655 `jackpot1`; `jackpot2` goes to power655 `jackpot2`. `toSafeInt` handles the bigint strings.
     - Omits `bonus` when it is null.
     - Rejects a missing source or fetched_at, as `priceQuoteFromRow` does.
   - Ticket mapper:
     - Validates that `lines` is an array of arrays of safe integers. It does not check game rules.
     - Validates status, channel and prize_tier against literal lists.
     - `StoredLotteryTicket` has `{ id, gameId, drawId, lines, costVnd, channel, purchasedAt, status, prizeTier, grossVnd, checkedAt, rawText, createdAt }`.
     - `LotteryTicketInput` has `{ gameId, drawId, lines, costVnd, channel, purchasedAt, rawText }`.
   - No prize, tax or cost calculation happens here (R1). `costVnd` is supplied by the caller from core `ticketCost`.

5. **Repo** `packages/db/src/repos/lottery.ts`, with the header comment "Callers must call requireUser() first (R6); the worker uses the service client directly."
   - `createLotteryTicket(db, input)`:
     - Inserts `lotteryTicketToRow({ ...input, lines: canonicalTicketLines(input.lines) })`.
     - Uses `.select(COLS).single()`.
     - 23505 becomes CONFLICT via `unwrap`.
   - `listLotteryTickets(db, { game?, status?, drawId? } = {})`: one `eq` per filter that is given, ordered by `purchased_at` desc, then `id` asc.
   - `getLotteryTicket(db, id)` uses `unwrapFound`.
   - `updateLotteryTicket(db, id, input)`:
     - Writes the canonical edited fields and resets `status='pending'`, `prize_tier`, `gross_vnd` and `checked_at` to null.
     - No row returns NOT_FOUND.
   - `recordLotteryTicketResult(db, id, { status: 'won' | 'lost', prizeTier, grossVnd, checkedAt })`:
     - Writes only the result columns.
     - The caller passes the values from core `checkTicket` (`topTier`, `grossVnd`).
     - No row returns NOT_FOUND.
   - `listPendingLotteryTickets(db, game, drawId)`.
   - `upsertLotteryDraws(db, rows, { chunkSize })`: dedupes on `game|draw_no` (last one wins), chunks sequentially, and uses `onConflict: 'game,draw_no'`, mirroring `upsertPricesIntraday`.
   - `getLotteryDraw(db, game, drawId)` uses `unwrapFound`.
   - Export everything from `packages/db/src/index.ts`.

6. Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm db:check`. Record the output in impl-log.md.

Rules check:
- R1: the repo stores the core results; no maths happens in it.
- R2: all money columns are bigint, and the mappers use `toSafeInt`.
- R3: grants go to service_role only, there are no policies, and the r3-guard test applies.
- R4: draw `source` and `fetched_at` are NOT NULL, and the mapper rejects them when missing.
- R5: number ranges, bao sizes and tax stay in core config. SQL keeps only loose structural bounds.
- R6: see AC 4 and A1.
- R7: no web or worker code in this ticket.
- R10: tickets are recorded only, with no order placement.

## Specialist input used
From `consult-database-optimizer.md`:
- **Adopted:**
  - §1: `lines jsonb` with a shape check, no child table, and canonical ordering. The canonicalisation lives in core.
  - §2: composite PK, explicit jackpot columns instead of pools jsonb, loose number checks, the bonus and jackpot2 shape checks, and no draw_date index (it is optional, and no date-ordered query exists yet).
  - §3: uuid id, no FK to draws, the status shape check, and the raw_text cap.
  - §4: two partial unique indexes and an md5 raw-text key.
  - §5: the pending partial index and the (game, purchased_at desc) index.
  - §6: RLS and grants exactly as in prices_intraday.
  - §7: the repo set, fake-client tests and upsert onConflict.
- **Modified:**
  - §4: raw-text whitespace normalisation is done **inside the index expression**, not in TS, so every write path is covered and `raw_text` stays verbatim.
  - §4: the identity index uses `md5(lines::text)` instead of raw `lines`, to stay under the btree row-size limit (up to 50 lines of up to 18 numbers).
  - §3: `lost` requires `gross_vnd = 0`, not "0 or null", so the summary never has to treat null as zero.
- **Rejected:**
  - `external_ref`: no use for it yet; it can be added with STK-056 if the SMS carries a ticket serial.
  - `tax_vnd` and `net_vnd` columns: see A3.
  - `result jsonb`: see A6.
  - Web `apps/web/server/lottery/handlers.ts`: belongs to STK-055 (see A1).

Open questions 1–6: **none is blocking.** Each one has a default that can be reversed with a small follow-up migration or code change and does not change this plan's structure. They are taken as assumptions A1–A6 below and repeated as follow-ups for Ming to confirm.

## Assumptions
- **A1 (consult Q6, requireUser).** "Server data functions call `requireUser()`" is met by the project's existing R6 pattern. CLAUDE.md says `requireUser()` "runs in every page, route handler and server action", and the data layer documents "Callers must call requireUser() first", which `entrypoints.test.ts` enforces. The repos cannot call `requireUser()` themselves: it depends on Next.js `cookies()`/`headers()`, and the STK-054 worker must use these repos without a user session. STK-055 adds the pages, actions and handlers, and they are covered by the entrypoints test.
- **A2 (consult Q1, channel).** `manual` is allowed alongside `sms` and `momo`, as the ticket AC says. The spec already describes "quick manual entry" as an entry method; the ticket makes it a channel value as well. **Spec conflict flagged:** F8 lists only `sms` / `momo`. Follow-up: Ming to confirm, then update the spec line.
- **A3 (consult Q3, tax).** "Prize amounts" means the stored `gross_vnd` only. Tax and net are recomputed by core (`checkTicket` / `summarizeTickets` with the effective-dated `LOTTERY_TAX_SCHEDULE`), so a corrected tax rule (R5) never leaves stale stored values. Columns can be added later if Ming wants a frozen snapshot.
- **A4 (consult Q4, drawId).** `drawId` is the draw number as a plain decimal string, `String(draw_no)`. Input with leading zeros (`'00123'`) parses to 123, so SMS-style padded numbers still match. This is defined once, in `drawIdFromNo` and `drawNoFromId`.
- **A5 (system size).** "System size" is not a separate column. Each line's length is its size (6 = regular, 5 or 7–18 = bao), as in the core `LotteryTicket` type. A ticket can mix sizes, so a single column could not hold them.
- **A6 (consult Q5, result jsonb).** There is no per-line result column. The per-line breakdown is recomputed with core `checkTicket` from `lines` and the stored draw when it is displayed.
- **A7 (edits).** Editing a ticket resets it to `pending` and clears the result, so a changed ticket is never shown with a stale win. The STK-054 job then checks it again.
- **A8 (consult Q2, identity key).** The identity unique key (game, draw, numbers, purchased_at) applies only to `channel = 'sms'`, because the AC scopes it to "duplicate SMS imports". A manual or MoMo entry can legitimately repeat the same numbers. The raw-text key applies to every channel whenever raw text is present.
- **A9.** Line cap: at most 50 lines per ticket and an 8 kB jsonb size limit. Real Vietlott slips have at most 6 lines.
- **A10.** The repo does not validate game rules. Callers validate with core `validateTicketLines` / `validateDrawResult` before writing (STK-054, STK-055). SQL rejects only structurally broken rows.

## Blocking questions
None.

## Split proposal
None. Estimated size: about 350 production lines (migration, about 110 lines of checks.sql, mappers and repo, a small core function) plus about 250 test lines. It is one feature: the F8 data layer. Splitting the schema from the repo would leave AC 4 untestable in the first slice.
