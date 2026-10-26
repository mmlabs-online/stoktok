# Review — STK-010

## Attempt 1 — 2026-10-25
Verdict: PASS

### Checks (run by reviewer)
- install: `pnpm install --frozen-lockfile`, exit 0
- typecheck: pass (core, db, web, worker)
- lint: pass (all packages)
- test: core 21 files / 230 passed; db 10 files / 65 passed + 1 todo; worker 4 files / 26 passed; web 15 files / 118 passed. These match impl-log.md.
- build: pass (`/settings` is a dynamic route)
- check:service-key: "OK: no service key material in client bundle" (0 hits for the sentinel, `SUPABASE_SERVICE_ROLE_KEY` and `service_role`)
- Runtime: `next start` against a stateful PostgREST stub (settings GET/upsert, transactions), driven by Chromium through playwright-core. The scripts and PNGs are in the session scratchpad under `stk-010/`, not in the repo. Both servers were stopped afterwards.

### Acceptance criteria
- [x] AC1: the form has every required field. Evidence: `settings.test.tsx › renders every field`. At runtime `/settings` renders the three cards with fee, tax, HOSE/HNX/UPCoM limits, settlement days, lot size, concentration and both treatment radios, at 375px and 1280px with no horizontal overflow. Touch targets are ≥ 44px (radios 52px at 375px).
- [x] AC2: the server action saves into `settings` in ppm/integers, and invalid values get Vietnamese errors from core. The auth part is waived (R6 suspended).
  - Tests: `validate-settings.test.ts` (ranges, all errors together, parse codes, bounds-derived params), `parse-input.test.ts › parseRatePercentInput/formatRatePercentInput` (round trip; 20-digit input gives TOO_LARGE), `server/settings/handlers.test.ts` (ppm payload, Vietnamese messages, echoed raw values, SAVE_FAILED, rethrow).
  - Runtime, "0,15": saved `fee_rate_ppm: 1500`.
  - Runtime, invalid input (`abc`, `-1`, `0,123456`, `40`, blank days, `1,5`, `0`): each field showed its Vietnamese error ("Nhập phần trăm, ví dụ 0,15.", "Giá trị phải từ 0% đến 5%.", "Tối đa 4 chữ số sau dấu phẩy.", "Giá trị phải từ 1% đến 30%.", "Bắt buộc nhập.", "Nhập số nguyên, ví dụ 100.", "Giá trị phải từ 1% đến 100%.") with `aria-invalid`. All typed text was kept, and nothing was written to the stub.
  - Runtime, blank fee: stored `fee_rate_ppm: null` (not 0), and the page shows "Chưa cấu hình" again.
  - The percent parser uses only regex + BigInt (`packages/core/src/entry/parse-input.ts:31-50`), with no float path.
- [x] AC3: with no row, the defaults match the CLAUDE.md table. Evidence: `validate-settings.test.ts › no row gives the CLAUDE.md defaults` (literal strings). At runtime with no row: tax `0,1`, HOSE `7`, HNX `10`, UPCoM `15`, settlement `2`, lot `100`, fee blank with "Chưa cấu hình", banner "Đang dùng giá trị mặc định — chưa lưu", concentration placeholder `20`.
- [x] AC4: rules are read from stored settings, and a test checks for hard-coded values.
  - Wiring: `transactions/handlers.ts:110` and `transactions/[id]/edit/page.tsx` use `getMarketRules(db)`. `OVERSELL_SELF` interpolates `settlementDays` taken from stored settings (`check-ledger-change.ts:66`). Fee, tax, settlement, holidays, treatment and concentration were already loaded from storage. The worker does not use these rules.
  - Runtime: after saving lot size 10, `/transactions/new` with qty 50 and odd lot unticked created the transaction. After saving lot 100, the same input was rejected with "bội số của 100".
  - Scan teeth: `no-hardcoded-rules.test.ts` has an empty allowlist and scans more than 20 files. Its self-check is bidirectional: every sample is caught and every pattern is used. I ran its patterns against the `main` versions of `server/transactions/handlers.ts` and `transactions/[id]/edit/page.tsx`. Both are flagged (`DEFAULT_TRADING_RULES`), so the test would have failed before this change.
- [x] AC5: no signal parameters in this ticket. The diff adds no signal fields. `mergeRuleConfigs` keeps other keys (`market-rules.test.ts › preserves unknown keys`).
  - Runtime: a stored row `rule_configs: { signals: { rsiPeriod: 14 }, market: { lotSize: 100, extra: 'keep' } }` was saved with lot 10. The result was `{ signals: { rsiPeriod: 14 }, market: { lotSize: 10, extra: 'keep', priceLimitPpm: {…} } }`. Holidays `['2026-09-02']` and withholding 50000 were carried through.

### Issues
#### Issue 1 — 🟡 should-fix — mobile layout
- **Where**: `apps/web/components/settings/settings-form.tsx:183`
- **Expected**: the plan (Approach §6) asks for a sticky save footer that stays reachable while scrolling at 375px.
- **Actual**: the footer uses `sticky bottom-0`, but the mobile bottom nav is `fixed bottom-0 z-10` (`components/shell/app-shell.tsx:34`, 51px tall). At 375×812 the "Lưu thay đổi" button sits at y=768–812, fully under the nav (`elementFromPoint` hits "Giao dịch"). It only appears once the user scrolls to the end of the form. The form still works and saving is possible, so this does not block.
- **Fix instruction**: offset the footer above the bottom nav on mobile, e.g. `bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0`, and give it a z-index below the nav. Also change `pb-[env(safe-area-inset-bottom)]` to `pb-[calc(0.75rem+env(safe-area-inset-bottom))]`, because it currently replaces the `p-3` bottom padding with 0 on devices without a notch.

### Rules R1–R10
No violations found.
- R1: the form and page have no arithmetic. Validation and conversion are in core.
- R2: BigInt only. Ppm values are integers.
- R3: the client form imports only types from `server/*`. check:service-key is clean.
- R5: one default definition each (`DEFAULT_MARKET_RULES`, and `DEFAULT_TRADING_RULES` derived from it). The scan is green.
- R6: suspended, not flagged.
- R7: every changed file is in the plan's list.
- R8: checks are green, and the new core logic has tests.

### Nits (do not block)
- `validate-settings.ts`: the `if` that returns errors repeats `'error' in …` checks that `Object.keys(errors).length` already covers. The extra checks are there only for type narrowing; a typed accumulator would read better.
- "Hủy" (`type="reset"`) after a failed submit resets to the echoed invalid values, not the stored ones, because React updates `defaultValue`. Acceptable with no dirty tracking.

### Follow-ups (out of scope)
- Issue 1 above, if the orchestrator does not fold it into a later UI ticket.
- Plan F1–F5 stand (withholding/holidays UI, price-limit consumers, atomic `rule_configs` merge, cutoff/sanity settings, per-exchange lot size).
- A legacy stored fee above 5% or a stored concentration of 0 loads into the form and blocks saving until corrected (accepted per A3). Consider a clearer message.
