Status: READY

# Plan — STK-052: Vietlott core: game rules, ticket checking and net result

> Re-planned 2026-11-05 after Ming answered Q1/Q2 (ticket "Notes / answers from Ming", last line). Q1: the tax threshold is a dated schedule: 10,000,000 VND for draws before 2026-07-01, 20,000,000 VND from 2026-07-01. Q2: the default tax basis is **per ticket per draw** (prizes summed, taxed once). AC4/AC6 and spec §3 F8 already reflect this. No blocking questions remain.

## Spec summary
docs/spec-v1.md §3 F8 Vietlott tracker (after v1.2, Ming 2026-11-05):
> "Personal record of Vietlott tickets Ming buys elsewhere (Vietlott SMS, MoMo). **Games: Mega 6/45 and Power 6/55 only**; Max 3D, Lotto 5/35 and Keno are out of scope."
> "Ticket ledger: game, draw number, numbers (regular and system/"bao" tickets), cost, …, status (`pending` / `lost` / `won` + prize tier)."
> "**History per game**: total spent, total won, net, with personal income tax on prizes (10% of the part of the prizes on one ticket per draw above 20,000,000 VND from 2026-07-01, 10,000,000 VND before — Law 109/2025/QH15; Ming, 2026-11-05); …" (spec line 106)
> "Prize tables, ticket price, draw days and tax threshold are configuration (R5). Money in integer VND (R2). All calculation in `packages/core` (R1)." (spec line 109)

docs/spec-v1.md §1.3: "No order placement of any kind (this includes Vietlott tickets: F8 only records tickets bought elsewhere)."
docs/spec-v1.md §10: "v1.3 | F8 Vietlott tracker (Mega 6/45, Power 6/55)".
CLAUDE.md R1 (calculations in core), R2 (integer VND, rounding defined once in core), R5 (rules are configuration).

**Scope of this ticket:** only the pure domain module in `packages/core`. No DB, no worker, no UI, no SMS parsing, no suggestions, no statistics, no VN-Index opportunity cost. Those are later F8 tickets.

No remaining spec/ticket conflict: spec §3 F8, AC4 and AC6 agree on the dated threshold and the per-ticket-per-draw basis.

## Acceptance criteria → verification
| # | Criterion (quoted from ticket) | How the reviewer verifies it |
|---|---|---|
| 1 | Game rules (number range, pick count, bonus number for Power, prize table, ticket price, draw weekdays, tax threshold and rate) are config objects, not hard-coded logic (R5). | Read `lottery/config.ts`: `MEGA_645`, `POWER_655`, `LOTTERY_TAX_SCHEDULE` and `DEFAULT_LOTTERY_TAX_BASIS` hold every value. `grep -nE '45\|55\|10_?000\|40_?000_?000\|20_?000_?000\|2026-07-01' packages/core/src/lottery/*.ts` outside `config.ts` and `*.test.ts` finds no rule literals. Test `config.test.ts › custom rules object changes the outcome` passes a modified rules object / tax schedule and the result follows it. |
| 2 | A pure function checks a ticket against a draw result and returns the prize tier (Power: Jackpot 1, Jackpot 2 = 5 + bonus, 1st–3rd; Mega: Jackpot, 1st–3rd) or none. | `check.test.ts › checkCombination …`: one test per tier per game, plus "0/1/2 matches → none", "Power 5+bonus → jackpot2, not first", "Power 6 → jackpot1 only", "Mega has no bonus". |
| 3 | System ("bao") tickets are expanded to their combinations; cost and every winning combination are counted correctly. | `combinations.test.ts › bao 7 → 7 combos, cost 70,000`; `› bao 5 Mega → 40 / Power → 50`; `› count equals choose()` for every allowed size; `check.test.ts › bao 7 with all 6 drawn → 1 jackpot + 6 × first`; `› Power bao 5 containing the bonus → jackpot2 counted`. |
| 4 | Prize tax is 10% of the part of the prizes on one ticket in one draw (summed) above a dated threshold: 10,000,000 VND for draws before 2026-07-01, 20,000,000 VND from 2026-07-01 (Law 109/2025/QH15); per-combination basis stays available in config; all amounts are integer VND (R2). Jackpot amount comes from the draw result, not config. | `tax.test.ts` boundary and schedule tests (below); `check.test.ts › per-ticket tax on bao ticket` (summed, taxed once) and `› perCombination basis via config`; `› jackpot amount taken from draw result`; every output amount checked with `Number.isSafeInteger`. |
| 5 | A function totals spent, won (gross and net) and net result for a list of tickets, per game. | `summary.test.ts › totals per game`, `› pending ticket counts as spent but not won`, `› games kept separate`, `› net result negative when losing`. |
| 6 | Unit tests cover every tier for both games, bao 7 expansion, tax boundary (20,000,000 and 20,000,001 from 2026-07-01; 10,000,000 and 10,000,001 before), per-ticket tax aggregation on a bao ticket, invalid tickets rejected; `typecheck`, `lint`, `test` green. | The tests listed below exist and pass; `pnpm typecheck && pnpm lint && pnpm test` green at the repo root. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `packages/core/src/lottery/types.ts` | create | Types: `GameId`, `GameRules`, `PrizeTier`, `TierId`, `TaxRule`, `TaxBasis`, `LotteryTicket`, `TicketLine`, `DrawResult`, `PoolPrize`, result/error types. |
| `packages/core/src/lottery/config.ts` | create | `MEGA_645`, `POWER_655`, `LOTTERY_GAMES`, `LOTTERY_TAX_SCHEDULE`, `DEFAULT_LOTTERY_TAX_BASIS` (AC1, AC4, R5). |
| `packages/core/src/lottery/combinations.ts` | create | `choose(n,k)`, `validateLine`, `expandLine`, `ticketCombinationCount`, `ticketCost` (AC3). |
| `packages/core/src/lottery/tax.ts` | create | `taxRuleFor(schedule, drawDate)`, `prizeTax(gross, rule)` (AC4). |
| `packages/core/src/lottery/check.ts` | create | `validateDrawResult`, `checkCombination`, `checkTicket` (AC2–AC4). |
| `packages/core/src/lottery/summary.ts` | create | `summarizeTickets` per game (AC5). |
| `packages/core/src/lottery/index.ts` | create | Barrel for the module. |
| `packages/core/src/lottery/config.test.ts` | create | Config shape and R5 override tests. |
| `packages/core/src/lottery/combinations.test.ts` | create | Expansion, counts, cost, line validation. |
| `packages/core/src/lottery/tax.test.ts` | create | Threshold boundaries for both periods, schedule selection. |
| `packages/core/src/lottery/check.test.ts` | create | Every tier for both games, bao wins, pools, tax basis, invalid draws. |
| `packages/core/src/lottery/summary.test.ts` | create | Per-game totals. |
| `packages/core/src/money.ts` | modify | Add `floorDiv(a, b)` (integer floor division, BigInt-exact). Jackpot shares must never exceed the pool, and R2 says rounding is defined once in core, so the helper lives here, not in the lottery module. |
| `packages/core/src/money.test.ts` | modify | Tests for `floorDiv`. |
| `packages/core/src/index.ts` | modify | Re-export the public lottery API and `floorDiv`. |

## Tests to write
| Test (file › name) | Covers |
|---|---|
| config.test.ts › Mega 6/45 rules: 1–45, pick 6, no bonus, price 10,000, Wed/Fri/Sun, tiers jackpot/first/second/third | AC1 |
| config.test.ts › Power 6/55 rules: 1–55, pick 6, bonus, Tue/Thu/Sat, tiers jackpot1/jackpot2/first/second/third | AC1 |
| config.test.ts › tiers ordered by rank; fixed amounts are safe integers | AC1, R2 |
| config.test.ts › tax schedule: two entries sorted by effectiveFrom — earliest (open start) 10,000,000, `2026-07-01` 20,000,000; ratePpm 100,000; default basis `perTicket` | AC1, AC4 |
| config.test.ts › custom rules object changes the outcome (modified 3rd prize amount / numberMax; custom tax schedule threshold) | AC1, R5 |
| combinations.test.ts › choose: C(7,6)=7, C(18,6)=18564, C(n,0)=1, k>n → 0 | AC3 |
| combinations.test.ts › regular line (6 numbers) → 1 combo, cost 10,000 | AC3 |
| combinations.test.ts › bao 7 → 7 distinct sorted combos, each omits one number, cost 70,000 | AC3, AC6 |
| combinations.test.ts › bao 5 Mega → 40 combos (400,000); Power → 50 combos (500,000); each contains all 5 picks | AC3 |
| combinations.test.ts › every allowed size: count === choose-based count; expanded length checked up to bao 10 (count only beyond, for speed) | AC3 |
| combinations.test.ts › multi-line ticket cost = sum of line costs | AC3 |
| combinations.test.ts › rejects: duplicate number, out of range (0; 46 on Mega; 56 on Power), non-integer, size not allowed (4, 19), empty line, ticket with no lines | AC6 |
| tax.test.ts › from 2026-07-01: gross 20,000,000 → tax 0 | AC4, AC6 |
| tax.test.ts › from 2026-07-01: gross 20,000,001 → tax 0 (10% of 1 VND rounds half-up to 0); 20,000,010 → 1; 40,000,000 → 2,000,000 | AC4, AC6 |
| tax.test.ts › before 2026-07-01: gross 10,000,000 → tax 0; 10,000,001 → 0; 10,000,010 → 1; 40,000,000 → 3,000,000 | AC4, AC6 |
| tax.test.ts › taxRuleFor: 2026-06-30 → 10M entry; 2026-07-01 → 20M entry; 2026-11-05 → 20M entry; very old date (e.g. 2016-01-01) → 10M entry | AC4 |
| tax.test.ts › gross below threshold → 0; jackpot-size gross (3e11) stays a safe integer | AC4, R2 |
| check.test.ts › Mega: 6 → jackpot, 5 → first, 4 → second, 3 → third, 2/1/0 → none | AC2, AC6 |
| check.test.ts › Power: 6 → jackpot1, 5+bonus → jackpot2, 5 without bonus → first, 4 → second, 4+bonus → second, 3 → third, 2/1/0 → none | AC2, AC6 |
| check.test.ts › jackpot amount taken from the draw result pool, not config | AC4 |
| check.test.ts › jackpot share with winnerCount 3 → floorDiv(pool, 3) | AC4 |
| check.test.ts › own winning combos > published winnerCount → own count used as divisor (A3) | AC4 |
| check.test.ts › pool tier hit but no pool amount in the draw → error `missing_pool_amount` | AC4 |
| check.test.ts › Mega bao 7 with all 6 drawn → 1 jackpot + 6 × first; gross = pool + 60,000,000 | AC3 |
| check.test.ts › Power bao 5 whose 5 picks are drawn regulars → 1 jackpot1 + 1 jackpot2 + 48 × first; gross summed | AC3 |
| check.test.ts › per-ticket tax on bao ticket (default basis): Mega bao 7 with exactly 5 drawn → 2 × first + 5 × second = 21,500,000 gross; draw on/after 2026-07-01 → tax applyRatePpm(1,500,000) = 150,000 (per-combination basis would give 0); draw before 2026-07-01 → tax 1,150,000 | AC4, AC6 |
| check.test.ts › perCombination basis via config: same ticket → each combo taxed separately and summed (0 after 2026-07-01; 0 before as each first prize = 10,000,000 = threshold) | AC4 |
| check.test.ts › multi-line ticket: prizes on all lines summed before the threshold (per-ticket basis) | AC4 |
| check.test.ts › result status `won` with highest tier or `lost`; cost, gross, tax, net all safe integers; net = gross − tax | AC2, R2 |
| check.test.ts › rejects: game mismatch, draw id mismatch, invalid draw (wrong count, duplicates, out of range, Power missing/duplicate bonus, Mega with bonus), invalid draw date | AC6 |
| summary.test.ts › totals per game: ticketCount, spent, wonGross, tax, wonNet, netResult | AC5 |
| summary.test.ts › pending ticket (no result) counts in spent and pendingCount, not in won | AC5 |
| summary.test.ts › Mega and Power totals kept separate; empty list → empty result | AC5 |
| summary.test.ts › netResult negative when only losing tickets | AC5 |
| money.test.ts › floorDiv: exact, rounds down, large values exact, rejects denominator ≤ 0 and non-integers | R2 |

Working for the bao 7 tax example: 5 of the 7 picks are drawn. Each of the C(7,6) = 7 combos drops one pick. Dropping one of the 2 undrawn picks (2 combos) leaves 5 drawn → first. Dropping a drawn pick (5 combos) leaves 4 drawn → second. Gross = 2 × 10,000,000 + 5 × 300,000 = 21,500,000. Per ticket, from 2026-07-01: 10% × 1,500,000 = 150,000. Before: 10% × 11,500,000 = 1,150,000.

## Approach
1. **Types and config (R5, AC1).** In `types.ts` and `config.ts`, following the consult's shape:
   ```
   GameRules { gameId: 'mega645' | 'power655', pickCount: 6, numberMin: 1, numberMax: 45|55,
     hasBonus, pricePerCombinationVnd: 10_000, systemSizes: [5, 7..18], drawWeekdays: ISO 1–7,
     tiers: [{ id, regularMatches, requiresBonus, prize: {kind:'fixed', amountVnd} | {kind:'pool'} }] }
   TaxBasis = 'perTicket' | 'perCombination'
   TaxRule { effectiveFrom: 'YYYY-MM-DD' | null, thresholdVnd, ratePpm }
   LOTTERY_TAX_SCHEDULE: TaxRule[] = [
     { effectiveFrom: null,         thresholdVnd: 10_000_000, ratePpm: 100_000 },  // before Law 109/2025/QH15
     { effectiveFrom: '2026-07-01', thresholdVnd: 20_000_000, ratePpm: 100_000 },  // Law 109/2025/QH15
   ]
   DEFAULT_LOTTERY_TAX_BASIS: TaxBasis = 'perTicket'   // Ming, 2026-11-05
   ```
   Basis is a separate argument/config value (not per schedule entry) so it can be switched without touching thresholds. Fixed prize defaults come from the ticket notes and match the consult: Mega 10,000,000 / 300,000 / 30,000; Power 40,000,000 / 500,000 / 50,000; each commented "verify before use". Tiers are ordered by rank. Bao 5 is special: each combination is the 5 picks plus one of the remaining numbers.
2. **Combinations (AC3).** `validateLine(rules, numbers)` → `{ ok: true, line } | { ok: false, error }` with codes `wrong_count`, `duplicate_number`, `out_of_range`, `not_integer`, `size_not_allowed`, `empty_ticket`. A line is valid with exactly `pickCount` numbers or a size in `systemSizes`. `expandLine` returns sorted 6-number combinations: C(k,6) for k ≥ 7; picks + each other number for k = 5. `ticketCombinationCount` computes the count without expanding (choose, or `numberMax − numberMin + 1 − 5` for bao 5). `ticketCost = count × price` via existing `money.ts` helpers.
3. **Draw validation and checking (AC2).** `validateDrawResult(rules, draw)` checks: `drawDate` is a valid `YYYY-MM-DD`; 6 unique in-range integers; bonus required and distinct when `hasBonus`, absent otherwise; each `pools[tierId]` is `{ amountVnd, winnerCount }` with safe integers ≥ 0. `checkCombination(rules, combo, draw)` counts regular matches, checks the bonus, walks `tiers` in rank order and returns the first match or `null` (highest tier only, consult §5).
4. **Prize amounts.** Fixed tiers use config. Pool tiers use `floorDiv(pool.amountVnd, max(pool.winnerCount, ownWinningCombosForTier))`; floor is documented as an approximation of Vietlott's pro-rata split (consult §6).
5. **Tax (AC4).** `taxRuleFor(schedule, drawDate)` returns the latest entry whose `effectiveFrom` is null or ≤ `drawDate` (string compare on ISO dates; schedule assumed sorted, validated in config test). `prizeTax(gross, rule) = applyRatePpm(max(0, gross − thresholdVnd), ratePpm)` — reuses the existing half-up helper (R2). In `checkTicket`: `perTicket` sums gross over every winning combination on every line of the ticket and taxes once; `perCombination` taxes each winning combination's gross and sums the taxes.
6. **`checkTicket(rules, ticket, draw, opts?: { taxSchedule?, taxBasis? })`** — defaults to `LOTTERY_TAX_SCHEDULE` / `DEFAULT_LOTTERY_TAX_BASIS`. Validates inputs and expands every line. Returns `{ ok: true, gameId, drawId, costVnd, combinationCount, wins: [{ lineIndex, combo, tierId, grossVnd }], tierCounts, grossVnd, taxVnd, netVnd, status: 'won' | 'lost', topTier, taxRule }` or `{ ok: false, error }`.
7. **`summarizeTickets(entries: { ticket, result?: CheckTicketOk }[], gamesRules = LOTTERY_GAMES)`** → per-game `{ ticketCount, pendingCount, spentVnd, wonGrossVnd, taxVnd, wonNetVnd, netResultVnd = wonNetVnd − spentVnd }`. Spent is computed from the ticket via `ticketCost` (so pending tickets count); won comes from the precomputed result. Sums via `addVnd`.
8. **Exports and checks.** Add exports to `index.ts`; run `pnpm typecheck && pnpm lint && pnpm test`.

Rules: R1 (all calculation in core, no UI), R2 (integer VND, BigInt-exact helpers, rounding only via `money.ts`), R5 (every rule value in config; functions take rules/schedule/basis as arguments with config defaults), R7 (no DB/worker/UI), R8 (unit tests for all new logic), R10 (no ticket purchase; only checks recorded tickets).

Size estimate: ~300 lines of logic, ~400 lines of tests. Over the ~400-line guide only because of tests; it is one feature, so no split.

## Specialist input used
From consult-finance-investment-researcher.md:
- **Adopted:** config shape for game rules (§Recommendations R5/AC1); dated tax schedule with 10M / 20M-from-2026-07-01 (§1, §Recommendations AC4 — now confirmed by Ming); per-ticket-per-draw basis as default with per-combination kept configurable (§2 — confirmed by Ming); reuse `applyRatePpm`; highest tier only per combination (§5); each bao combination checked on its own; Power bao 5 can hit Jackpot 2 (§7); bao sizes 5, 7–18 with C(k,6) counts (§7); pool share = floor(pool ÷ winnerCount) (§6); extra tests for bao 7 with 6 hits, Power bao 5 JP2, jackpot share with winnerCount > 1, per-ticket tax aggregation (§AC6); safe-integer size check.
- **Adopted as default, flagged:** Power bao range assumed equal to Mega's (5, 7–18); lives in config.
- **Not adopted:** dated game config (`effectiveFrom` on game rules) — nothing asks for it; follow-up.
- **Not adopted:** payment date as the tax point — core has no payment date yet; draw date is used (A2).

## Assumptions
- A1. A core `LotteryTicket` = one Vietlott ticket (one SMS / paper ticket ID): `{ gameId, drawId, lines: number[][] }`, 1..n lines, each regular or bao. Per-ticket tax sums across all lines (consult Q3; consistent with Ming's "per ticket per draw"). DB modelling is a later ticket.
- A2. The tax period is selected by the draw date (`draw.drawDate`), since core has no payment date. A later ticket can pass a payment date instead. Edge: a draw before 2026-07-01 paid after it would use 10M here.
- A3. Pool tiers (Mega jackpot, Power jackpot1/jackpot2) take their amount from `draw.pools[tierId] = { amountVnd, winnerCount }`. If the published `winnerCount` is lower than Ming's own winning combinations for that tier, Ming's own count is the divisor.
- A4. Fixed prizes are never capped or shared (consult §8 unverified).
- A5. Power bao range 5, 7–18 (unverified, consult §7). Prize values are the ticket defaults, marked "verify before use".
- A6. Draw weekdays are config data only; no function validates a draw date against them (not required by the ACs).
- A7. Tax rounding uses the existing half-up `applyRatePpm` (integer VND × 10% has at most one decimal digit, so 20,000,001 → tax 0).
- A8. The first schedule entry has `effectiveFrom: null` (applies to all earlier draws); no attempt to model pre-Circular-111 rules.

## Blocking questions
None.

Non-blocking (for go-live, not this ticket): allow vietlott.vn in the session network so prize tables and the Power bao range can be checked against official pages (consult Q4).

## Split proposal
None.
