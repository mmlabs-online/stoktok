# STK-040: Reject adjusted-price history in VCI responses

| Field | Value |
|---|---|
| State | DONE |
| Priority | P2 |
| Areas | data |
| Attempts | 1 |
| Created | 2026-11-01 |
| PR | — |

## Goal
Make sure the VCI source never stores adjusted prices. VCI returns adjusted prices for every session before a symbol's latest corporate action. When a response contains a bar with a non-integer price, every bar on or before the latest such date is rejected, including bars whose adjusted values happen to be whole numbers.

## Spec reference
docs/spec-v1.md §2.2 (gaps are detected, not silently filled), §4.3 (adapters). CLAUDE.md R2 (prices are integer VND), R4 (stale or gapped data never produces a signal; gaps are recorded). ADR 0004 (VCI source; raw vs adjusted was unverified), STK-036 (raw-price guards for MA rules), STK-038.

## Acceptance criteria
- [ ] Within one VCI response for a symbol, if any bar has a non-integer open, high, low or close, every bar with a trade date on or before the latest such bar's date is rejected with a dedicated reason code (e.g. `adjusted_history`). Integer-valued bars in that range are rejected too.
- [ ] Bars after the cut-off date are processed as today, through the existing core normalization and guards.
- [ ] During `--backfill`, a cut-off found for a symbol also rejects that symbol's bars in older chunks of the same run.
- [ ] Rejected bars are never written; already stored rows for those dates stay unchanged. Missing dates are recorded as gaps by the existing logic. Nothing is filled in.
- [ ] ADR 0004 records the finding from the first live dry-run (2026-11-01): VCI returns adjusted prices before the latest corporate action and raw prices after it. It also documents the new guard.
- [ ] Tests use fixtures and the no-network guard only. They cover a mixed response, the integer-coincidence case, and a backfill cut-off across chunks. `typecheck`, `lint` and `test` pass.

## Notes / answers from Ming
- Requested by Ming on 2026-11-01 after the first live `--dry-run --source vci-public`. TCB bars from 2026-10-05 to 2026-10-28 had fractional prices (e.g. open 22701.14), while 2026-10-29 and 2026-10-30 were whole numbers. AGR showed the same pattern up to about 2026-10-08. The core guard rejected them as `invalid_open`, so nothing was stored.
- Run `pnpm worker:eod --backfill` only after this ticket lands.
- Out of scope: storing adjusted prices on purpose (conflicts with R2 and needs its own decision), and the BCG "no bars" case.
