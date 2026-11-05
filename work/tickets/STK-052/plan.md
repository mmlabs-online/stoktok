Status: BLOCKED

# Plan — STK-052: Vietlott core: game rules, ticket checking and net result

> Blocked on two tax questions that only Ming can decide (see **Blocking questions**). Everything else is planned in full below. Once Ming answers, only the tax defaults in `config.ts` and the tax tests in step 5 / AC4 / AC6 change. The structure stays the same.

## Spec summary
docs/spec-v1.md §3 F8 Vietlott tracker (after v1.2, Ming 2026-11-05):
> "Personal record of Vietlott tickets Ming buys elsewhere (Vietlott SMS, MoMo). **Games: Mega 6/45 and Power 6/55 only**; Max 3D, Lotto 5/35 and Keno are out of scope."
> "Ticket ledger: game, draw number, numbers (regular and system/"bao" tickets), cost, …, status (`pending` / `lost` / `won` + prize tier)."
> "History per game: total spent, total won, net, with personal income tax on prizes (10% of the part of a prize above 10,000,000 VND); …"

docs/spec-v1.md §1.3: "No order placement of any kind (this includes Vietlott tickets: F8 only records tickets bought elsewhere)."
docs/spec-v1.md §10: "v1.3 | F8 Vietlott tracker (Mega 6/45, Power 6/55)".
CLAUDE.md R1 (calculations in core), R2 (integer VND, rounding defined once in core), R5 (rules are configuration).

**Scope of this ticket:** only the pure domain module in `packages/core`. No DB, no worker, no UI, no SMS parsing, no suggestions, no statistics, no VN-Index opportunity cost. Those are later F8 tickets.

**Spec conflict to flag:** spec §3 F8 and ticket AC4/AC6 both say 10,000,000 VND. The finance consult reports that Law 109/2025/QH15 raised it to 20,000,000 VND from 2026-07-01. This is blocking question Q1.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | Game rules (number range, pick count, bonus for Power, prize table, ticket price, draw weekdays, tax threshold and rate) are config objects, not hard-coded logic (R5). | Read `lottery/config.ts`: `MEGA_645`, `POWER_655` and `LOTTERY_TAX_SCHEDULE` hold every value. `grep -nE '45\|55\|10_?000\|40_?000_?000\|20_?000_?000' packages/core/src/lottery/*.ts` (excluding `config.ts` and tests) finds no literal rule values. Test `config.test.ts › custom rules object changes the outcome` passes a modified rules object (for example 3rd prize = 1 VND, or numberMax = 10) and the result follows it. |
| 2 | A pure function checks a ticket against a draw result and returns the prize tier (Power: Jackpot 1, Jackpot 2 = 5 + bonus, 1st–3rd; Mega: Jackpot, 1st–3rd) or none. | `check.test.ts › checkCombination …` tests: one per tier per game, plus "0/1/2 matches → none", "Power 5+bonus → jackpot2, not first", "Power 6 matches → jackpot1 (highest only)", "Mega bonus ignored". |
| 3 | System ("bao") tickets are expanded to their combinations; cost and every winning combination are counted correctly. | `combinations.test.ts › expandLine bao 7 → 7 combos, cost 70,000`; `› bao 5 Mega → 40 combos / Power → 50 combos`; `› combination count equals choose()` for every allowed size; `check.test.ts › bao 7 with all 6 drawn → 1 jackpot + 6 × first`; `› Power bao 5 containing bonus → jackpot2 counted`. |
| 4 | Prize tax is 10% of the part of each prize above the threshold; all amounts are integer VND (R2). Jackpot amount comes from the draw result, not config. | `tax.test.ts` boundary tests (values depend on Q1); `check.test.ts › jackpot amount taken from draw result`; `› jackpot share with winnerCount > 1 uses floorDiv`; every output field is checked with `Number.isSafeInteger`. The tax basis (per ticket or per combination, Q2) is tested through `check.test.ts › tax basis …`. |
| 5 | A function totals spent, won (gross and net) and net result for a list of tickets, per game. | `summary.test.ts › totals per game`, `› pending ticket counts as spent but not won`, `› mixed games kept separate`, `› net result = net won − spent (negative when losing)`. |
| 6 | Unit tests cover every tier for both games, bao 7 expansion, tax boundary, invalid tickets rejected; `typecheck`, `lint`, `test` green. | Tests listed below exist and pass; `pnpm typecheck && pnpm lint && pnpm test` green at the repo root. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/lottery/types.ts` | create | Types: `GameId`, `GameRules`, `PrizeTier`, `TierId`, `TaxRule`, `TaxBasis`, `LotteryTicket`, `TicketLine`, `DrawResult`, `PoolPrize`, result/error types. |
| `packages/core/src/lottery/config.ts` | create | `MEGA_645`, `POWER_655`, `LOTTERY_GAMES`, `LOTTERY_TAX_SCHEDULE` (AC1, R5). |
| `packages/core/src/lottery/combinations.ts` | create | `choose(n,k)`, `validateLine`, `expandLine`, `ticketCombinationCount`, `ticketCost` (AC3). |
| `packages/core/src/lottery/tax.ts` | create | `taxRuleFor(schedule, date)`, `prizeTax(gross, rule)` (AC4). |
| `packages/core/src/lottery/check.ts` | create | `validateDrawResult`, `checkCombination`, `checkTicket` (AC2–AC4). |
| `packages/core/src/lottery/summary.ts` | create | `summarizeTickets` per game (AC5). |
| `packages/core/src/lottery/index.ts` | create | Barrel for the module. |
| `packages/core/src/lottery/config.test.ts` | create | Config shape and R5 override test. |
| `packages/core/src/lottery/combinations.test.ts` | create | Expansion, counts, cost, validation. |
| `packages/core/src/lottery/tax.test.ts` | create | Threshold boundaries, schedule selection. |
| `packages/core/src/lottery/check.test.ts` | create | Every tier for both games, bao wins, pools, tax basis, invalid draws. |
| `packages/core/src/lottery/summary.test.ts` | create | Per-game totals. |
| `packages/core/src/money.ts` | modify | Add `floorDiv(a, b)` (integer floor division, BigInt-exact). Jackpot shares must never exceed the pool, and R2 says rounding helpers are defined once in core, so the helper goes here and not inside the lottery module. |
| `packages/core/src/money.test.ts` | modify | Tests for `floorDiv`. |
| `packages/core/src/index.ts` | modify | Re-export the public lottery API and `floorDiv`. |

## Tests to write
| Test (file › name) | Covers |
|---|---|
| config.test.ts › Mega 6/45 rules: 1–45, pick 6, no bonus, price 10,000, Wed/Fri/Sun, tiers jackpot/first/second/third | AC1 |
| config.test.ts › Power 6/55 rules: 1–55, pick 6, bonus, Tue/Thu/Sat, tiers jackpot1/jackpot2/first/second/third | AC1 |
| config.test.ts › tiers are ordered by rank and fixed amounts are safe integers | AC1, R2 |
| config.test.ts › tax schedule entries are sorted by effectiveFrom, integer threshold, ratePpm 100,000 | AC1, AC4 |
| config.test.ts › custom rules object changes the outcome (modified 3rd prize amount / numberMax) | AC1, R5 |
| combinations.test.ts › choose: C(7,6)=7, C(18,6)=18564, C(n,0)=1, k>n → 0 | AC3 |
| combinations.test.ts › regular line (6 numbers) → 1 combo, cost 10,000 | AC3 |
| combinations.test.ts › bao 7 → 7 distinct sorted combos, each omits one number, cost 70,000 | AC3, AC6 |
| combinations.test.ts › bao 5 Mega → 40 combos (cost 400,000); Power → 50 combos (cost 500,000); each contains all 5 picks | AC3 |
| combinations.test.ts › every allowed size: expanded length === ticketCombinationCount === choose-based count (bao 8–18 count only, no expansion beyond bao 10 for speed) | AC3 |
| combinations.test.ts › multi-line ticket cost = sum of line costs | AC3 |
| combinations.test.ts › rejects: duplicate number, out of range (0, 46 on Mega, 56 on Power), non-integer, size 6 < n not allowed (e.g. 4, 19), bao 6 as a bao is just a regular line, empty lines | AC6 |
| tax.test.ts › gross exactly at threshold → tax 0 | AC4, AC6 |
| tax.test.ts › gross threshold + 1 → tax 0 (10% of 1 VND rounds half-up to 0); threshold + 10 → 1 | AC4, AC6 |
| tax.test.ts › gross below threshold → 0; jackpot-size gross (3e11) stays a safe integer | AC4, R2 |
| tax.test.ts › taxRuleFor picks the entry by date (earlier period vs period from 2026-07-01, if Q1 = yes) | AC4 |
| check.test.ts › Mega: 6 → jackpot, 5 → first, 4 → second, 3 → third, 2/1/0 → none | AC2, AC6 |
| check.test.ts › Power: 6 → jackpot1, 5+bonus → jackpot2, 5 without bonus → first, 4 → second, 3 → third, 4+bonus → second (bonus only matters for jackpot2), 2/1/0 → none | AC2, AC6 |
| check.test.ts › jackpot amount taken from the draw result pool, not config | AC4 |
| check.test.ts › jackpot share with winnerCount 3 → floorDiv(pool, 3) | AC4 |
| check.test.ts › own winning combos > published winnerCount → use own count (see Assumptions) | AC4 |
| check.test.ts › pool tier hit but the draw result has no pool amount → error `missing_pool_amount` | AC4 |
| check.test.ts › bao 7 containing all 6 drawn numbers (Mega) → 1 jackpot + 6 × first; gross = pool + 6 × 10,000,000 | AC3 |
| check.test.ts › Power bao 5 whose 5 picks are drawn regulars → 1 jackpot2 (combo with bonus) + 1 jackpot1 (combo with 6th regular) + 48 × first … gross summed | AC3 |
| check.test.ts › tax basis per ticket: tax applied once to summed gross; per combination: tax applied to each winning combo and summed (both via config) | AC4 (Q2) |
| check.test.ts › result: status `won` with highest tier, or `lost`; gross, tax, net, cost all safe integers | AC2, R2 |
| check.test.ts › rejects: game mismatch, draw id mismatch, invalid draw (wrong count, duplicates, out of range, Power missing/duplicate bonus, Mega with bonus) | AC6 |
| summary.test.ts › totals per game: spent, wonGross, tax, wonNet, netResult | AC5 |
| summary.test.ts › pending ticket (no draw result yet) counts in spent and pendingCount, not in won | AC5 |
| summary.test.ts › Mega and Power totals kept separate; empty list → no games / zero totals | AC5 |
| summary.test.ts › netResult negative when only losing tickets | AC5 |
| money.test.ts › floorDiv: exact, rounds down, large values exact, rejects denom ≤ 0 | R2 |

## Approach
1. **Types and config (R5, AC1).** In `types.ts` and `config.ts`, following the consult's shape:
   ```
   GameRules { gameId: 'mega645' | 'power655', pickCount: 6, numberMin: 1, numberMax: 45|55,
     hasBonus, pricePerCombinationVnd: 10_000, systemSizes: [5, 7..18], drawWeekdays: ISO 1–7,
     tiers: [{ id, regularMatches, requiresBonus, prize: {kind:'fixed', amountVnd} | {kind:'pool'} }] }
   TaxRule { effectiveFrom: 'YYYY-MM-DD', thresholdVnd, ratePpm: 100_000, basis: 'perTicket' | 'perCombination' }
   LOTTERY_TAX_SCHEDULE: TaxRule[]   // values per Q1/Q2
   ```
   Fixed prize defaults come from the ticket notes and match the consult: Mega 10,000,000 / 300,000 / 30,000; Power 40,000,000 / 500,000 / 50,000. Each is marked in a comment as "verify before use". Tiers are ordered by rank. Bao 5 is a special size, not C(k,6): each combination is the 5 picks plus one of the remaining numbers.
2. **Combinations (AC3).** `validateLine(rules, numbers)` returns `{ ok: true, line } | { ok: false, error: LotteryError }`. Errors use codes like `wrong_count`, `duplicate_number`, `out_of_range`, `not_integer`, `size_not_allowed`. A line is valid with exactly `pickCount` numbers, or with a size listed in `systemSizes`. `expandLine` returns sorted 6-number combinations: C(k,6) for k ≥ 7, and picks + each other number for k = 5. `ticketCombinationCount` computes the count without expanding (choose, or `numberMax − numberMin + 1 − 5` for bao 5). `ticketCost = count × price` via `mulDiv`/`addVnd`.
3. **Draw validation and checking (AC2).** `validateDrawResult(rules, draw)` checks: 6 unique in-range integers; bonus required and distinct when `hasBonus`, absent otherwise; and every `pools[tierId]` is `{ amountVnd, winnerCount }` with safe integers ≥ 0. `checkCombination(rules, combo, draw)` counts regular matches, checks the bonus, and walks `tiers` in rank order. It returns the first tier whose conditions hold, or `null`, so only the highest tier is paid.
4. **Prize amounts.** Fixed tiers use the config amount. Pool tiers use `floorDiv(pool.amountVnd, max(pool.winnerCount, ownWinningCombosForTier))`. The floor rounding is documented as an approximation of Vietlott's pro-rata split (consult §6).
5. **Tax (AC4, depends on Q1/Q2).** `taxRuleFor(schedule, drawDate)` returns the latest entry with `effectiveFrom ≤ drawDate`. `prizeTax(gross, rule) = applyRatePpm(max(0, gross − threshold), ratePpm)`, which reuses the existing half-up helper (R2). In `checkTicket`, `basis: 'perTicket'` sums gross over every winning combination on the ticket and taxes it once. `'perCombination'` taxes each winning combination and sums the taxes.
6. **`checkTicket(rules, taxSchedule, ticket, draw)`** validates the inputs and expands every line. It returns `{ ok: true, gameId, drawId, costVnd, combinationCount, wins: [{ lineIndex, combo, tierId, grossVnd }], tierCounts, grossVnd, taxVnd, netVnd, status: 'won' | 'lost', topTier }` or `{ ok: false, error }`.
7. **`summarizeTickets(entries: { ticket, result?: CheckTicketOk }[])`** returns per-game totals: `ticketCount`, `pendingCount`, `spentVnd`, `wonGrossVnd`, `taxVnd`, `wonNetVnd`, `netResultVnd = wonNetVnd − spentVnd`. It takes results already computed by `checkTicket`, so the function stays pure and does no checking itself. Sums use `addVnd`.
8. **Exports and checks.** Add exports to `index.ts`, then run `pnpm typecheck && pnpm lint && pnpm test`.

Rules: R1 (all calculation in core, no UI touched), R2 (integer VND everywhere, BigInt-exact helpers, rounding only via `money.ts`), R5 (every rule value lives in config; functions take `rules`/`schedule` as arguments), R7 (no DB, worker or UI), R8 (unit tests for all new logic), R10 (no ticket purchase or placement; the module only checks recorded tickets).

Size estimate: about 300 lines of logic and about 350 lines of tests. That is above the ~400-line guide only because of tests. The ticket is still one feature, so no split.

## Specialist input used
From consult-finance-investment-researcher.md:
- **Adopted:** the config shape for game rules and the dated tax schedule (§Recommendations R5/AC1/AC4); reuse `applyRatePpm`; highest tier only per combination (§5); each bao combination checked on its own; Power bao 5 can hit Jackpot 2 (§7); bao sizes 5, 7–18 with C(k,6) counts (§7); pool share = floor(pool ÷ winnerCount) (§6, AC4); extra tests for bao 7 with 6 hits, Power bao 5 JP2, jackpot share with winnerCount > 1, per-ticket tax aggregation (§AC6); safe-integer size check (§Recommendations).
- **Adopted as a default, flagged:** the Power bao range is assumed to be the same as Mega's (5, 7–18). It lives in config, so it is easy to change.
- **Not adopted yet (blocked):** the 20M threshold from 2026-07-01 and the per-ticket tax basis default. Both contradict or reinterpret the ticket and spec, so Ming decides (Q1, Q2).
- **Not adopted:** a dated game config (`effectiveFrom` on game rules). Nothing asks for it; noted as a follow-up.
- **Not adopted:** the payment date as the tax point. Core has no payment date yet, so the draw date is used (see Assumptions).

## Assumptions
- A1. A core `LotteryTicket` = one Vietlott ticket (one SMS / paper ticket ID): `{ gameId, drawId, lines: number[][] }`, with 1..n lines, each a regular line or a bao line. This covers multi-line tickets for per-ticket tax aggregation (consult Q3). How the DB models it is decided in a later ticket.
- A2. The tax period is chosen by draw date, since core has no payment date. A later ticket can pass a payment date instead.
- A3. Pool tiers (Mega jackpot, Power jackpot1/jackpot2) take their amount from `draw.pools[tierId] = { amountVnd, winnerCount }`. If the published `winnerCount` is lower than Ming's own winning combinations for that tier (stale or incomplete data), the divisor is Ming's own count.
- A4. Fixed prizes are never capped or shared (consult §8 unverified); they are paid as configured.
- A5. The Power bao range is 5, 7–18, the same as Mega (unverified for Power, consult §7). The prize values are the ticket's defaults, marked "verify before use".
- A6. Draw weekdays are config data only in this ticket. No function checks a draw date against them, because the ACs do not require it.
- A7. Tax rounding uses the existing half-up `applyRatePpm` (amounts are integer VND, so 10% has at most one decimal digit).

## Blocking questions
- **Q1 (tax threshold).** Spec §3 F8 and AC4/AC6 say "10% of the part of a prize above **10,000,000 VND**". The finance consult reports that Personal Income Tax Law 109/2025/QH15, in effect from **2026-07-01**, raised the threshold to **20,000,000 VND** (rate still 10%). Should the plan:
  (a) use a dated schedule (before 2026-07-01 → 10,000,000; from 2026-07-01 → 20,000,000), with boundary tests at 20,000,000 / 20,000,001 plus one 10,000,000 test for the earlier period, and update the spec line? This is the consult's recommendation.
  (b) keep 10,000,000 only, as the ticket says?
  Either way the threshold stays in config. The question is the default values, and whether the AC and spec text change.
- **Q2 (tax basis).** AC4 says "each prize". The legal wording quoted by the consult is per lottery **ticket** per draw: all prizes on one ticket are summed and taxed once. On a bao ticket this gives different numbers from taxing each winning combination separately. Which default: (a) **per ticket** (the consult's default), or (b) **per combination**? Both will be supported in config; the default and the tests depend on the answer. If Ming has a real Vietlott payout slip or an official FAQ, that settles it.

Non-blocking (for go-live, not for this ticket): allowing vietlott.vn in the session network so the prize tables and the Power bao range can be checked against the official pages (consult Q4).

## Split proposal
None.
