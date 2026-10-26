## Attempt 1 — 2026-10-26
Verdict: PASS

Scope: slice A. AC2 is narrowed (the Settings screen is STK-033). R6 is suspended, so missing auth is not reviewed. Ming's notes apply: MA rules suppress until STK-032 backfills, and the minimum is 5 peers.

### Checks (run by reviewer)
- install: `pnpm install --frozen-lockfile` exit 0.
- typecheck: exit 0 (core, db, worker, web).
- lint: exit 0.
- test: core 347 passed (31 files); db 100 passed, 1 todo (14 files); worker 65 passed (8 files); web 148 passed (18 files). These match impl-log.md.
- build: exit 0 (web build Done).
- check:service-key: `OK: no service key material in client bundle` (0 hits for both patterns).
- db:check: `db:check OK`. Ran apply ×5, checks, rollback of all 5 (signals first), re-apply, then checks again.
- End-to-end job run against an in-memory fake store. Script: `/tmp/claude-0/-home-user-stoktok/a3b909eb-ece1-56b0-9d9d-9c54d1ddc6ba/scratchpad/stk015-review/e2e.mts`, output in `e2e.out` next to it. It ran through worker `tsx`, outside the repo. The fake universe has 15 symbols: 7 clean banks, STALE, GAPPY, FINOLD, NEGEPS, FETCHOLD (all banks) and 3 steel. Findings:
  - **Idempotency.** I ran Monday 12:00 VN, Monday 13:00 VN and Saturday. All three got signal_date 2026-10-23. The 75 keys stayed 75 rows, the rows were identical apart from computed_at, and the ids were unchanged.
  - **signal_date floor.** A Monday 19:00 VN run with no Monday bars gave signal_date 2026-10-26 (= expected). It wrote 75 new rows with `price_stale`, and Friday's rows were untouched. A Friday 17:00 VN run (expected Thursday) with Friday bars stored gave signal_date 2026-10-23.
  - **Suppression reasons:**

    | Case | Reason codes | data_fresh |
    |---|---|---|
    | STALE | `price_stale` on pb, pe and both MAs | false |
    | GAPPY (one day missing 10 sessions back) | `price_gap` on MA50 and MA200; P/B still ok | false |
    | Market-wide `prices_daily` gap (symbol null) | `price_gap_recorded`, with `data_gaps:77` cited in refs | false |
    | Market-wide `financials` gap | `financials_gap_recorded` on growth/pb | false |
    | FINOLD (latest 2026Q1 < expected 2026Q2) | `financials_stale` | false |
    | FETCHOLD (fetched 2026-09-01) | `financials_fetch_stale` | false |
    | NEGEPS (basis flipped to quarterly) | `eps_non_positive` | true |
    | Steel (2 peers) | `peers_insufficient` | true |
    | Universe of 6 banks (exactly 5 peers) | P/B ok | — |
    | Universe of 5 banks (4 peers) | `peers_insufficient` | — |
    | Production basis | every pe row has `eps_basis_unverified` | true when the data is fresh |

  - **Labels.** Only `bullish`, `bearish`, `neutral` or null appear. Every value is a safe integer or null.
  - **Snapshot.** Refs are `prices_daily:SYM:date`, `financials:SYM:YYYYQn`, `symbols:SYM:sector` and `data_gaps:id`. Each carries source and fetchedAt (gaps carry fromTs/toTs). The snapshot also holds the parsed `params` and `epsBasis`. The MA window records table, range, count, closes, sources and the fetched range.
- **Hand check, P/B (AAA).** Close 20000 and BVPS 15000 give 1333333 ppm. The 8 valid peers' P/B values sort to 1200000…1312500. The median is (1250000+1263158)/2 = 1256579. Premium = (1333333−1256579)×10⁶/1256579 = 61082 ppm. The job stored `value 61082`, `medianPpm 1256579`, label neutral (inside ±200000). ✔
- **Hand check, MA50 (AAA).** Closes are 20000+10i for i=0..49, so MA = 20245. (20000−20245)×10⁶/20245 = −12101.7, giving −12102 ppm. The job stored `ma 20245`, `value −12102`, neutral (band 20000). MA200 = 20995 gives −47392, bearish. ✔

### Acceptance criteria
- [x] AC1: rules are pure core functions with unit tests, including edge cases. `peVsSector`/`pbVsSector` (`packages/core/src/signals/valuation.ts:148,154`), `earningsGrowthTrend` (`growth.ts`) and `priceVsMa` (`moving-average.ts`) take no clock and do no I/O. Tests cover:
  - "missing middle quarter or only 3 of 4 -> financials_gap" (`inputs.test.ts:102`);
  - "fewer than comparisons+4 quarters -> financials_gap" (`growth.test.ts:47`);
  - "TTM EPS 0 or negative -> eps_non_positive" (`valuation.test.ts:39`);
  - the negative base → turnaround/to_loss/loss cases (`growth.test.ts:27`).

  All pass.
- [x] AC2 (narrowed): parameters come from `settings`. `parseSignalRules` reads `rule_configs.signals.medium` with a per-key fallback (`config.test.ts:18`, plus the cross-field pair test at :39). `getSignalRules` is in `packages/db/src/repos/settings.ts`, and the job uses `store.getSignalRules()` ("uses rules from store", `medium-signals.test.ts:76`). A grep finds no threshold literals in the rule files. `mergeRuleConfigs` keeps the `signals` namespace when the market settings are saved. The Settings UI is in STK-033.
- [x] AC3: stale or gapped data never produces a signal, and the reasons are recorded. Evidence: the core tests, `medium-signals.test.ts:87,123`, the e2e table above, and the db:check cases `sig suppressed with value`, `sig ok but not fresh`.
- [x] AC4: the migration is `supabase/migrations/20261026000200_signals.sql`. It has the spec columns plus the justified extras, the natural-key unique constraint, and the state/fresh/reason/snapshot checks. RLS is on, anon/authenticated are revoked on the table and the sequence, and only service_role has grants. db:check covers it: tables_exist, signals_columns, the RLS/no-policies/no-grants/denied loops (they run over all tables, signals included), service_role upsert with the id kept, and 14 rejects_bad_rows cases. The rollback is present.
- [x] AC5: the job runs after EOD and is idempotent per symbol and day, with the snapshot stored. Evidence: `pnpm worker:signals [--dry-run]`, the README schedule (18:55 and 21:15, after 18:45 financials and the EOD sync), upsert on `symbol,rule_id,horizon,signal_date` (`signals.test.ts:22`), and job tests :103/:114/:132. The e2e confirms identical rows and ids across re-runs.
- [x] AC6: plan completion vs annual target has no rule. It is in the impl-log Follow-ups.

### Issues
None blocking.

### Rules R1–R10
No violations found.
- **R1:** all rule, freshness and date logic is in `packages/core/src/signals`. The job only orchestrates, and there are no web changes.
- **R2:** BigInt `mulDiv`/`roundDiv`, ppm integers, `value bigint`. No float math in the rule files.
- **R3:** the store is worker-only and service-key check is green.
- **R4:** refs carry source and fetched_at, a sector without provenance is rejected by `symbolSectorFromRow`, and data reasons set data_fresh=false. The DB enforces `data_fresh or status='suppressed'`.
- **R5:** every threshold is in `DEFAULT_SIGNAL_RULES`, with settings fallback per key. The publish lag is one core constant.
- **R7:** the only extra file is `signals/fixtures.ts` (a test helper), justified under Out-of-plan files.
- **R8:** green, with new core tests.
- **R9/R10:** the label is a direction, and the DB check rejects `buy`. No action is decided.

### Nits (do not block)
- `apps/worker/src/jobs/medium-signals.ts:85`: `fromPeriod` is anchored at the latest expected quarter. For a symbol whose newest stored quarter is older (FINOLD in the e2e), growth reports `financials_gap` as well as `financials_stale`, because its 8th quarter back was never fetched. It is still suppressed correctly, but the extra reason is misleading. Widening the read by one quarter, or anchoring the gap check, would fix it.
- `packages/core/src/signals/growth.ts:32,39`: `mulDiv` is not guarded the way valuation uses `safeRatioPpm`. A RangeError would abort the whole job rather than suppress one row with `value_out_of_range`. Realistic VND magnitudes cannot reach it.
- `packages/core/src/signals/valuation.ts:97,140`: peers are snapshotted as `{symbol, ratioPpm}` without their own refs (source/fetchedAt). The median is reproducible from the stored ratios, but the peer inputs themselves are not cited.

### Follow-ups (out of scope)
- An incomplete `settings.holidays` list (for example Tết) makes `price_gap` fire for every symbol across the 200-day window (fail-safe). Consider a check or warning when the same missing date appears for all symbols (`inputs.ts:96`), or seed the VN holidays before STK-032.
- Cite the peer input refs in the valuation snapshot (see the nit above) before STK-016 or the AI explanation cites them.
- The rest as listed in impl-log.md, notably the raw-price guards with STK-032 and the EPS-basis flip plus ADR 0002 update.
