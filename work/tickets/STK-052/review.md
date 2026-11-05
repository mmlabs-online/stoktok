## Attempt 1 — 2026-11-05
Verdict: REWORK

### Checks (run by reviewer)
- typecheck: green (`pnpm typecheck` exit 0, all workspaces)
- lint: green (`pnpm lint` exit 0, all workspaces)
- test: green — core 50 files / 646 tests passed; sources 24, db 128 (+1 todo), worker 229, web 300. Matches impl-log.

### Acceptance criteria
- [x] AC1 Game rules are config — evidence: `packages/core/src/lottery/config.ts` (MEGA_645, POWER_655, LOTTERY_TAX_SCHEDULE, DEFAULT_LOTTERY_TAX_BASIS); grep for rule literals in non-config, non-test lottery files finds none; `config.test.ts › custom rules object changes the outcome` passes.
- [x] AC2 Tier check — evidence: `check.ts` `checkCombination`; `check.test.ts › checkCombination › Mega tiers / Power tiers` (6, 5+bonus, 5, 4, 4+bonus, 3, 2/1/0) pass.
- [ ] AC3 Bao expansion; cost counted correctly — expansion and checking pass (`combinations.test.ts › bao 7…`, `› bao 5 Mega 40 / Power 50`, `› every allowed size`; `check.test.ts › Mega bao 7…`, `› Power bao 5…`), but cost is silently wrong for invalid lines. See Issue 1.
- [x] AC4 Tax — evidence: `tax.ts`; `tax.test.ts` boundaries for both periods and `taxRuleFor` dates; `check.test.ts › per-ticket basis sums then taxes once` (150,000 / 1,150,000), `› perCombination basis via options`, `› multi-line ticket sums prizes across lines`, `› jackpot amount from the draw result`, `› shares by published winnerCount (floor)`.
- [ ] AC5 Per-game totals — tests pass (`summary.test.ts`), but `summarizeTickets` accepts invalid tickets and returns a wrong `spentVnd`. See Issue 1.
- [ ] AC6 "invalid tickets rejected" — `checkTicket` rejects them (`check.test.ts › checkTicket rejects`), but `ticketCost` / `ticketCombinationCount` / `summarizeTickets` do not. See Issue 1.

### Issues
#### Issue 1 — 🔴 blocker — correctness (money from invalid input)
- **Where**: `packages/core/src/lottery/combinations.ts:57-70` (`lineCombinationCount`, `ticketCombinationCount`, `ticketCost`), `packages/core/src/lottery/summary.ts:32`.
- **Expected**: An invalid ticket (wrong size, duplicates, out of range, empty) never produces a money figure. Pending tickets go to `summarizeTickets` without passing through `checkTicket`, so the summary is where they must be rejected.
- **Actual**: These functions do not validate. Every size below `pickCount` is treated as bao 5: a Mega line `[1,2,3]` counts as 45−3 = 42 combinations, so `ticketCost` = 420,000 VND. An empty line counts as 45 combinations = 450,000 VND. Size 6 with duplicates counts as 1. `summarizeTickets([{ ticket: { gameId:'mega645', drawId:'M1', lines:[[1,2,3]] } }])` returns `spentVnd: 420000` with no error. These functions are part of the public core API (`lottery/index.ts`).
- **Fix instruction**: In `ticketCombinationCount` (which `ticketCost` uses), run `validateTicketLines(rules, ticket)` first and throw `RangeError` with the error code/message when it fails. Keep the throw style the other money helpers use. In `summarizeTickets`, the throw then propagates. Also throw `RangeError` there when `result` is given and `result.gameId !== ticket.gameId` or `result.drawId !== ticket.drawId`. Add tests: `combinations.test.ts › ticketCost / ticketCombinationCount throw on invalid ticket` (size 3, empty line, duplicate, no lines), and `summary.test.ts › rejects invalid pending ticket` and `› rejects result for another ticket`.

### Rules R1–R10
No violations found. R1/R2: all logic is in `packages/core`, integer VND via BigInt-exact helpers (`floorDiv` added to `money.ts` with tests, `applyRatePpm` half-up reused). R5: values only in `config.ts`. R7: the packages diff is exactly the plan's file list. R8: new logic has tests. R10: no purchase path.

### Nits (do not block)
- `money.ts` `floorDiv` doc: "a a non-negative-or-negative safe integer" is awkward; "a any safe integer" says the same thing.
- `check.ts:102` `topTier` reduce on `indexOf` could be `rules.tiers.find((t) => tierCounts[t.id])?.id ?? null`.
- `check.test.ts › own winning combos above winnerCount…` first assertion only checks `tierCounts`, not the share with `winnerCount: 0`; assert `grossVnd` of the jackpot2 win (1,000) too.
- Impl-log says "~+900 lines". The packages diff is ~770.

### Follow-ups (out of scope)
- Fixed prize amounts and Power bao range need checking against vietlott.vn before go-live (plan A5).
- Use the payment date instead of the draw date for tax period selection once the ledger stores it (plan A2).
- Dated game config (`effectiveFrom` on game rules) if Vietlott changes the prize tables.
