## Attempt 1 — 2026-10-23
Verdict: REWORK

Scope reviewed: `git diff 69b1d5a^..HEAD` (STK-009 only; STK-008 is in PR #7). AC4 is narrowed per ticket.md (assets CRUD → STK-030). R6 is suspended, so missing auth is not flagged.

### Checks (run by reviewer)
- install: `pnpm install --frozen-lockfile`, already up to date.
- typecheck: pass (core, worker, db, web).
- lint: pass (all 4 packages).
- test: core 17 files / 169 passed; db 9 files / 47 passed + 1 todo; web 10 files / 89 passed. These match impl-log.md.
- build: pass. `/` is `ƒ` (dynamic), so nothing is prerendered from the DB.
- check:service-key: OK, 0 hits in `.next/static`.
- Runtime: I ran `next start` against a throwaway PostgREST stub at VN time 16:12 on Friday 2026-10-23, so the expected price date was 2026-10-22. Every scenario returned HTTP 200, with no horizontal overflow at 375px or 1280px. Screenshots are in `/tmp/claude-0/-home-user-stoktok/a3b909eb-ece1-56b0-9d9d-9c54d1ddc6ba/scratchpad/stk-009/{a,b,c,d}-{375,1280}.png`.
  - (a) No transactions: the empty state shows with a link to `/transactions/new`, and the cash/other cards still render (70.000.000 ₫).
  - (b) `prices_daily` empty, 7 holdings: every row shows "—" and "Chưa có dữ liệu", the "Chưa tính 7 mã chưa có giá" note is present, and no −100% appears. **But the summary cards show "Giá trị cổ phiếu 0 ₫" and "Lãi/lỗ chưa chốt ■ 0 ₫ đứng giá".** See Issue 1.
  - (c) Mixed data. I hand-checked the numbers:
    - FPT: cost 12.558.810, MV 13.000.000, P&L +441.190 (+3,51%), weight 25,34%. It shows "Vượt ngưỡng 20,00%" and appears in the banner.
    - SSI and VCB sit at 17,54%, with no warning.
    - VNM's stale price (giá 20/10/2026) shows "Dữ liệu cũ" and is counted in totals.
    - HPG has no price and is excluded.
    - Totals: Σ unrealized +133.365 ₫, net worth 121.300.000 = 51.300.000 + 70.000.000.
    - MWG was bought on 22/10, so Khả dụng 0 (T+2).
  - (d) With `fee_rate_ppm` NULL, the page shows the same values as (c), adds the fee banner, and does not 500.

### Acceptance criteria
- [x] AC1 Holdings table from core: quantity, sellable quantity, average cost, last close, MV, unrealized P&L (VND and %), weight, and realized total. Evidence: `portfolio.test.tsx › holdings row renders all columns, as table and cards`; `build-portfolio.test.ts › rows`, `› realized`; screenshots c-1280 and c-375.
- [x] AC2 MV, weights and net worth are computed in core, with tests. Evidence: `packages/core/src/portfolio/build-portfolio.ts:71-139` (BigInt, `addVnd`, reuses `valueHoldings`); `build-portfolio.test.ts` (valuation incl. >2^53 intermediates, weights, net worth, totals %); `no-calc-in-ui.test.ts` green. The tsx files contain no arithmetic.
- [x] AC3 Concentration warning from configured threshold (R5). Evidence: `build-portfolio.ts:98` uses the exact `BigInt(mv) * PPM > threshold * BigInt(denom)` comparison, guarded by `denom > 0`. `build-portfolio.test.ts › concentration` covers equal → false, the rounded-equal-but-exactly-above → true case, a single holding, 1 000 000 → never warns, and null → 200 000. `settings.ts:69` reads `concentration_threshold_ppm` (DB check 0..1e6). Runtime case (c) confirms the behaviour.
- [x] AC4 (narrowed) Net worth = holdings MV + cash + other, from existing `assets` rows. Evidence: `build-portfolio.ts:112-128`; `build-portfolio.test.ts › net worth`; `load-dashboard.test.ts › passes assets into totals`; runtime (c).
- [ ] AC5 Price date shown, and stale/missing prices flagged, never silently treated as current (R4). Per row this passes: `freshness.test.ts`, `portfolio.test.tsx › stale row…`, `› missing-price row…`, and runtime (b)/(c). It **fails at summary level when no holding has a price**. See Issue 1.
- [x] AC6 Empty state when there are no transactions. Evidence: `page.tsx:39-48`; `load-dashboard.test.ts › no transactions -> hasTransactions false`; screenshots a-375 and a-1280. The plan's render test was not written; impl-log explains why. Runtime evidence is enough here.
- [x] No 500 when the fee rate is NULL, the settings row is missing, or the ledger is invalid. Evidence: `load-dashboard.test.ts` (8 cases) and runtime (d).

### Issues
#### Issue 1 — 🔴 blocker — R4: unpriced holdings shown as a 0 ₫ value and a "flat" P&L
- **Where**: `packages/core/src/portfolio/build-portfolio.ts:79,111,117-120` (`holdingsMarketValue`/`unrealizedPnl` are `0` when `pricedCount === 0`) and `apps/web/components/portfolio/portfolio-summary.tsx:24,30-39`.
- **Expected**: The plan's AC5 check says that with an empty `prices_daily` "the page shows no 0 ₫ market value". When holdings are open but none has a price, the stock value and unrealized P&L are unknown. The page must show them as unknown ("—"), not as 0.
- **Actual**: Runtime case (b) (b-1280.png, b-375.png) has 7 open positions and no prices. The cards read "Giá trị cổ phiếu **0 ₫**" and "Lãi/lỗ chưa chốt **■ 0 ₫ đứng giá**", which states a definite flat P&L. The "Chưa tính 7 mã" note does not undo that statement.
- **Fix instruction**:
  1. In `PortfolioTotals`, change `holdingsMarketValue` and `unrealizedPnl` to `number | null`. Set both to `null` when `rows.length > 0 && pricedCount === 0`. Keep `0` when there are no open rows, so the empty ledger and case (a) stay as now. Compute `netWorth` with `0` in place of the null stock value, so it is still cash + other, as now.
  2. In `portfolio-summary.tsx`, render `<MoneyText vnd={totals.holdingsMarketValue} />` (null → "—"). When `totals.unrealizedPnl === null`, render "—" for Lãi/lỗ chưa chốt, with no tone, glyph or sr label, and call `changeTone` only when the value is non-null.
  3. Update `build-portfolio.test.ts › net worth › all missing` to expect `holdingsMarketValue: null, unrealizedPnl: null, netWorth: 17_500`.
  4. Add a `portfolio.test.tsx` case: all holdings unpriced, so `PortfolioSummary` output contains no `0 ₫` in those two cards and has no "đứng giá".
  5. Adjust `load-dashboard.test.ts › empty prices_daily` if it asserts the 0.

#### Issue 2 — 🟡 should-fix — Disclaimer rendered twice
- **Where**: `apps/web/app/(app)/page.tsx:56`. `apps/web/components/shell/app-shell.tsx:29` already renders `<DisclaimerNote />`.
- **Expected**: One disclaimer per page, as on the other pages.
- **Actual**: "Thông tin chỉ mang tính tham khảo…" appears twice on `/` (every screenshot). At 375px the copy in the page body sits behind the bottom nav.
- **Fix instruction**: Remove the `<DisclaimerNote />` element and its import from `page.tsx`. The plan asked for it, but the shell already provides it.

### Rules R1–R10
- R1: No violations found. The tsx files only format and read fields; `nonStockAssets` is added in core so the UI does no addition.
- R2: No violations found. Integers and BigInt are used throughout. `priceQuoteFromRow` rejects non-integer and negative closes.
- R3: Data access goes only through `server/db`. `check:service-key` is OK.
- R4: `source`/`fetched_at` are required by the mapper (`mappers.ts:43-53`). Issue 1 is the remaining R4 gap.
- R5: The threshold comes from settings, with the default in `portfolio/config.ts`. The cutoff is a config constant.
- R6: Suspended. A loader comment marks where `requireUser()` goes.
- R7: Scope is fine. The one out-of-plan file, `packages/db/test/fake-client.ts` (adds `'limit'`), is justified in impl-log.
- R8: Checks are green and the new core logic has tests.
- R9 and R10: not applicable.

### Nits (do not block)
- 💭 Mobile cards: on unpriced rows, the "—" for Lãi/lỗ and Tỷ trọng is left-aligned while every other value is right-aligned (`holdings-table.tsx:21,38`; HPG in c-375.png). Wrapping the null branches in the same `items-end` span would fix it.
- 💭 `resolveConcentrationThreshold` does not range-check, but the DB check constraint covers it.
- 💭 Case (a), with no holdings, shows "Lãi/lỗ chưa chốt ■ 0 ₫ đứng giá". That is true but a little odd.

### Follow-ups (out of scope)
- Extract the page body so the empty states get render tests (from impl-log).
- Liabilities/margin asset type; `data_gaps`-aware staleness after STK-005; a price-unit sanity check in the STK-005 adapter (from plan).

## Attempt 2 — 2026-10-23
Verdict: PASS

Scope reviewed: the rework commit `git show HEAD` (8fe8197) and the full STK-009 diff `git diff 69b1d5a^..HEAD`. AC4 is narrowed (assets CRUD → STK-030). R6 is suspended.

### Checks (run by reviewer)
- install: `pnpm install --frozen-lockfile`, already up to date.
- typecheck: pass (core, worker, db, web).
- lint: pass (all 4 packages).
- test: core 17 files / 169 passed; db 9 files / 47 passed + 1 todo; web 10 files / 90 passed. These match impl-log.md attempt 2.
- build: pass; `/` is still `ƒ` (dynamic).
- check:service-key: OK, 0 hits in `.next/static`.
- Runtime: I re-ran `next start` against the same PostgREST stub (scratchpad `stk-009/stub.mjs`), for case (b) and case (c), at 375px and 1280px. All four loads returned HTTP 200 with no horizontal overflow. Screenshots are in `/tmp/claude-0/-home-user-stoktok/a3b909eb-ece1-56b0-9d9d-9c54d1ddc6ba/scratchpad/stk-009/attempt2/{b,c}-{375,1280}.png`. Servers were stopped afterwards.
  - (b) `prices_daily` empty, 7 holdings: "Giá trị cổ phiếu —" and "Lãi/lỗ chưa chốt —". The page text has no "đứng giá" and no 0 ₫ in either card. Tổng tài sản is 70.000.000 ₫ (cash + other), and "Chưa tính 7 mã chưa có giá" is present. The disclaimer appears exactly once.
  - (c) Mixed prices: the numbers are unchanged from attempt 1. Net worth is 121.300.000, stock value 51.300.000, unrealized ▲ +133.365 ₫ (+0,26%). FPT is +441.190 / +3,51% / 25,34% with "Vượt ngưỡng 20,00%". SSI and VCB are at 17,54%. VNM shows "Dữ liệu cũ" (giá 20/10/2026), HPG shows "—", and MWG has Khả dụng 0. The disclaimer appears exactly once and there is no "đứng giá".

### Acceptance criteria
- [x] AC1 Holdings table from core. Unchanged from attempt 1; runtime (c).
- [x] AC2 MV, weights and net worth computed in core, with tests. `build-portfolio.ts:116-123` adds `nothingPriced` and returns `null` totals. `build-portfolio.test.ts › net worth › all missing` expects `holdingsMarketValue: null, unrealizedPnl: null, netWorth: 17_500`.
- [x] AC3 Concentration warning. Unchanged; runtime (c) FPT.
- [x] AC4 (narrowed) Net worth = MV + cash + other. Unchanged; runtime (b) 70.000.000 and (c) 121.300.000.
- [x] AC5 Price date and stale/missing flags (R4). Issue 1 from attempt 1 is resolved. `portfolio-summary.tsx:14,32-40` renders "—" with no tone, glyph or sr label when the value is null, and the stock value goes through `MoneyText` (null → "—"). Evidence: `portfolio.test.tsx › all holdings unpriced…`, `load-dashboard.test.ts › empty prices_daily` (asserts the null totals), and runtime (b).
- [x] AC6 Empty state. Unchanged. `rows.length > 0` keeps 0 for the empty ledger.

### Attempt 1 issues
- Issue 1 (🔴 R4, 0 ₫ / "đứng giá" for unpriced holdings): **resolved** (see AC5).
- Issue 2 (🟡 duplicate disclaimer): **resolved**. `page.tsx` no longer imports or renders `DisclaimerNote`, and runtime shows it once.
- Nit (mobile "—" alignment): fixed in `holdings-table.tsx:22,39`; b-375.png shows the values right-aligned.

### Issues
None.

### Rules R1–R10
No violations found. The null decision is made in core (R1). Values stay integer/BigInt (R2). `check:service-key` is OK (R3). No out-of-plan files were changed in the rework (R7). Checks are green and the core change is tested (R8). R6 is suspended.

### Nits (do not block)
- 💭 `portfolio-summary.tsx:32`: the `|| style === null` check is redundant with `unrealizedPnl === null`. It is harmless and only helps type narrowing.
- 💭 Carried over: `resolveConcentrationThreshold` does no range check (the DB constraint covers it), and case (a) shows "0 ₫ đứng giá" when there are no holdings.

### Follow-ups (out of scope)
- Same as attempt 1: extract the page body so the empty states get render tests; liabilities/margin asset type; `data_gaps`-aware staleness after STK-005; a price-unit sanity check in the STK-005 adapter.
