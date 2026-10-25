# Review — STK-011

## Attempt 1 — 2026-10-25
Verdict: PASS

Scope reviewed: `git diff 569e159^..HEAD` (STK-011 only; STK-010 is in PR #9). R6 suspended, missing auth not flagged.

### Checks (run by reviewer)
- install: `pnpm install --frozen-lockfile` exit 0
- typecheck: exit 0 (core, db, web, worker)
- lint: exit 0 (core, db, web, worker)
- test: exit 0. core 268 passed (23 files), db 75 passed + 1 todo (11 files), worker 27 passed (5 files), web 148 passed (18 files). Matches impl-log.
- build: exit 0, `ƒ /watchlist` (dynamic)
- check:service-key: "OK: no service key material in client bundle" (0 hits for `SUPABASE_SERVICE_ROLE_KEY` / `service_role` in `.next/static`)
- db:check: exit 0. Apply, checks, rollback (`20261025000100_symbols.down.sql` first), re-apply, checks, "db:check OK"

### Runtime check (next start + stateful PostgREST stub, Chromium via playwright-core)
Run on 2026-10-25 (Sun), so the expected price date is Fri 2026-10-23. Stub, script and PNGs are in the scratchpad `stk-011/` folder, outside the repo. Servers stopped afterwards.
- **Empty state, 375 and 1280:** status 200, no horizontal overflow. Shows "Đang nắm giữ (0)" / "Chưa có mã nào đang nắm giữ" and "Đang theo dõi (0)" with the add form visible and "Chưa theo dõi mã nào".
- **Held and watched:** held FPT and VNM (FPT after a partial sell). VNM is held and watched and is shown once, in Holdings, marked "Đang theo dõi" (1 visible VNM link at each width).
- **HOSE, two consecutive closes, FPT ref 25,400:** 25,400 × 1.07 = 27,178, rounded down to the 50 tick = **27,150**. 25,400 × 0.93 = 23,622, rounded up = **23,650**. The board shows TC 25,40 / Trần 27,15 / Sàn 23,65. The close of 27,150 has `text-price-ceiling` + `bg-price-ceiling` and the "Trần" tag.
- **HOSE across a band edge, MWG ref 9,500:** raw 10,165 falls in the 50-tick band, so 10,150. Raw 8,835 rounds up to the 10 tick, so 8,840. The board shows 10,15 / 8,84.
- **HNX, SHS ref 15,000:** 16,50 / 13,50. A close of 13,500 gets the floor tone, `bg-price-floor` and the "Sàn" tag.
- **UPCoM, BSR ref 12,300:** 14,10 / 10,50, with the ref tone.
- **Unknown exchange:** ACB has no `symbols` row and GAS has `exchange = null`. Both show Trần/Sàn "—" and "Chưa rõ sàn". Change and % are still shown, with the up/down tone. Neither defaults to HOSE.
- **Gap, HPG with closes on 10-23 and 10-21:** TC/Trần/Sàn/+/-/% all show "—", with the warning "Thiếu phiên trước, chưa tính tham chiếu".
- **Ex-date session, VNM cash dividend with ex 10-23:** close 66,00 is shown, the reference values are "—", and the row reads "Phiên GDKHQ: tham chiếu chưa xác định".
- **Stale row, MWG last close 10-21:** shows "giá 21/10/2026" and "Dữ liệu cũ". The close sits at the ceiling (10,150), but its tone is downgraded to `text-price-up` while the limits stay shown.
- **Add with exchange:** "vcb" + HOSE gives `symbols {VCB, HOSE}` and a watchlist row. The input is cleared. The new row shows "Chưa có dữ liệu" and "Giá sẽ có sau lần đồng bộ cuối ngày tiếp theo".
- **Add with an invalid symbol:** "V!" gives `#symbol-error` "Mã chứng khoán gồm 3-10 chữ cái hoặc chữ số." with `aria-invalid=true`.
- **Blank exchange never wipes a stored one:**
  - Adding held FPT (stored HOSE) with a blank exchange succeeds, and FPT stays HOSE.
  - Re-adding SHS (HNX) with a blank exchange shows "Mã đã có trong danh sách theo dõi.", and SHS stays HNX.
  - The stub log shows only 3 `POST /symbols` (VCB, ACB set, SHS clear) and none for the blank adds.
- **Remove:**
  - HPG is removed from the table and the row disappears.
  - Removing VNM from its Holdings row keeps VNM in Holdings, without the marker or the button.
- **Set exchange:**
  - ACB set to HNX is stored and the row then shows 26,40 / 21,60, which matches 24,000 ± 10%.
  - Clearing SHS explicitly stores null, and the row then shows "—" and "Chưa rõ sàn".
- **Layout:** all controls are 44px tall at 375. No horizontal overflow at either width. There were no page errors. One unrelated console 404 for a resource appeared at 375 (it did not reproduce on rerun, and no stub table was missing).

### Acceptance criteria
- [x] **AC1:** Holdings are derived from the ledger, never stored. Watching add/remove go through server actions (auth waived, R6). Evidence:
  - `load-watchlist.ts:47-52` and `load-watchlist.test.ts › holdings come from the ledger…` / `› held+watched symbol shown once…`
  - `handlers.test.ts` add/remove/setExchange cases
  - `actions.ts` is `'use server'` → handlers → `getDb()`
  - Runtime add/remove above.
- [x] **AC2:** last close, change and %, volume, and TC/Trần/Sàn are computed in core from configured limits. Evidence:
  - `price-board.ts:441-466` (`priceLimits` reads `rules.priceLimitPpm[exchange]`) and `buildPriceBoardRow`
  - The loader passes `getMarketRules(db)` (`load-watchlist.ts:45,766`)
  - `price-board.test.ts › uses the rules input…`
  - Runtime values hand-checked above.
- [x] **AC3:** colors are up green, down red, ref yellow, ceiling purple, floor cyan. Evidence: every class comes from `TONE_STYLES` (`price-board.tsx`), `watchlist.test.tsx › tones…`, and the runtime class dump (FPT ceiling, SHS floor, BSR ref, ACB up, GAS down).
- [x] **AC4:** each row shows its update time and a DataFreshnessBadge, and stale or gapped rows are flagged. Evidence:
  - `price-board.tsx` `Status`
  - `price-board.test.ts` stale / gapped / ex-date / missing cases
  - `watchlist.test.tsx` stale / gapped / missing cases
  - Runtime MWG and HPG rows.
- [x] **AC5:** adding a symbol puts it in the EOD sync set. Evidence: the handler writes `watchlist` (`handlers.ts:659`), `apps/worker/src/store.test.ts › listWatchlistSymbols reads listWatchlist`, and the existing eod-sync watchlist ∪ held test.
- [x] **AC6:** unit tests cover the core ref/ceiling/floor helper. Evidence: `price-board.test.ts` covers tickSize, the band guards, HOSE ±7% with tick rounding and band edges, HNX/UPCoM, rules input, ppm 0, bad ref, and the priceTone round-trip.
- [x] **Migration and db:check.** `20261025000100_symbols.sql`:
  - Has the PK regex check, a nullable exchange checked against `('HOSE','HNX','UPCOM')`, RLS enabled, a revoke from anon/authenticated, and grants to service_role, all in one file.
  - The rollback exists.
  - `checks.sql` adds `symbols` to the table list, the column checks, 3 rejected rows (`vnm`, `HSX`, `hose`), a null-exchange insert and a service_role read/write.
  - The generic RLS, no-policies, no-grants and anon/authenticated-denied loops also cover the new table.

### Issues
None blocking.

### Rules R1–R10
No violations found.
- **R1:** the tsx only formats. `page.tsx` uses only `.length`/`.map` for counts and the symbol list. Date comparisons (`priceDateDiffers`) and ex-date filtering live in the server loader. `no-calc-in-ui.test.ts` passes.
- **R2:** BigInt integer math. `rawCeiling` uses floor division and `rawFloor` uses ceil division. Ceiling is rounded down to `tick(rawCeiling)` and floor up to `tick(rawFloor)` (`price-board.ts:454-463`). The band-edge invariant guarantees the results are on a tick, and `floor ≤ ref ≤ ceiling` is asserted. % uses core `mulDiv`.
- **R3:** DB access only through `server/db.ts`. The client components import only types from the server modules. check:service-key is OK.
- **R4:** source and fetched_at are shown on every row. Stale, gapped, ex-date, no-reference and off-tick rows are flagged, and no reference is ever fabricated. `storedCloseFromRow` reuses the source/fetched_at validation and rejects negative volume.
- **R5:** limits come from `getMarketRules` (`rule_configs`). The tick table is `DEFAULT_TICK_BANDS` in core `market/config.ts`, passed in by the caller and marked UNVERIFIED. No limit or tick literals appear in web code.
- **R7:** every changed file is in the plan. The one out-of-plan file, `messages-vi.test.ts` (a one-line CODES addition), is justified.
- **R8:** checks are green, and the new core logic has tests.

### Nits (do not block)
- 💭 `handlers.ts:658-662`: a duplicate add *with* a chosen exchange still upserts `symbols` (as the plan intends) but returns a failure state, so `revalidatePath` does not run and the new exchange only shows after a reload.
- 💭 `price-board.tsx` desktop table: the `+/-`, `%` and `KL` cells have no horizontal padding. At 1280, "-10,00%" and "+6,89%" butt against the volume (see `full-1280.png`).
- 💭 Mobile card for a ceiling/floor row: the "Trần"/"Sàn" tag appears on both the close and the `PriceChange` chip, so it is shown twice.
- 💭 `flags.exchangeUnknown` is true for rows with no data. The UI hides it, and the implementer already logged this.

### Follow-ups (out of scope)
- Make `tickBands` configurable through `rule_configs` and the settings UI.
- Compute a theoretical ex-date reference from `corporate_actions`, or store the source's reference price.
- OR open `data_gaps` rows into the gapped flag (STK-031).
- Go-live verification: the tick table, the ceiling-down/floor-up direction, and raw vs adjusted prices.
- Replace `getRecentCloses`' N queries with a single `.in()` query if the symbol count grows.
