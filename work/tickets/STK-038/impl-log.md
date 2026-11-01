## Attempt 1 — 2026-11-01

### Files touched
| File | Required because |
|---|---|
| apps/worker/src/sources/vci.ts (new) | VciPriceSource adapter (AC1, AC3, AC5) |
| apps/worker/src/sources/http.ts | private requestJson + postJson; getJson unchanged in behaviour; no headers option |
| apps/worker/src/sources/select-price-source.ts (new) | config-driven factory (AC2) |
| apps/worker/src/config.ts | PRICE_SOURCE_IDS, isPriceSourceId, EOD_SYNC_CONFIG.priceSource, VCI_CONFIG, comment tweak |
| apps/worker/src/cli.ts | `--source` flag (eod-prices only), factory in EOD branch, USAGE |
| apps/worker/src/sources/vci.test.ts (new) | adapter tests |
| apps/worker/src/sources/select-price-source.test.ts (new) | factory tests |
| apps/worker/src/config.test.ts (new) | span invariant |
| apps/worker/src/sources/http.test.ts | postJson cases |
| apps/worker/src/cli.test.ts | --source cases |
| apps/worker/src/jobs/eod-sync.test.ts | describe block with real VciPriceSource and fixture-style fetch |
| apps/worker/test/fixtures/vci/* (README + 8 JSON) | SYNTHETIC fixtures |
| docs/adr/0004-vci-eod-price-source.md (new) | ADR |
| docs/adr/0001-eod-price-source.md | amendment line |
| apps/worker/README.md | EOD section: default source, --source, first dry-run |

### Tests added / changed
- vci.test.ts (19 tests), select-price-source.test.ts (4), config.test.ts (1), http.test.ts postJson (2), cli.test.ts --source (3), eod-sync.test.ts with VciPriceSource (3). Existing tests untouched.
- The eod-sync VCI tests build the response in the fetch stub from the request body (one bar on the target date) rather than reading a JSON fixture, because dates must follow the run's target date.

### Checks (actual output summary)
Run with Node v22.23.4 (the default node 18 cannot run vitest/next).
- typecheck: all 4 packages Done, no errors.
- lint: all Done, no errors or warnings.
- test: core 474 passed; db 117 passed, 1 todo; worker 126 passed (11 files); web 214 passed.

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- Symbol batching; replace synthetic fixtures with a sanitized real capture after the first dry-run; update ADR 0004 UNVERIFIED after that run; decide on `--backfill` rewrite of TCBS-era rows if VCI is adjusted (Ming).
- Header check: grep of vci.ts/http.ts for Origin/Referer/Mozilla/Chrome/cookie matched nothing.

### Scope self-check
- Could the diff be smaller? No; eod-sync.ts, price-source.ts, tcbs.ts and core are untouched.
- Diff size: ~+240 lines product/ADR/README, ~+330 tests and fixtures.
