## Attempt 1 — 2026-11-01
Verdict: PASS

### Checks (run by reviewer, Node v22.23.4)
- typecheck: packages/core, packages/db, apps/web, apps/worker — all Done, exit 0.
- lint: all 4 packages Done, no errors or warnings.
- test: core 474 passed (39 files); db 117 passed + 1 todo (14 files); worker 126 passed (11 files); web 214 passed (25 files). Matches impl-log.md.

### Acceptance criteria
- [x] AC1 New `PriceSource` via core normalization/guards; `source`=`vci-public`, `fetched_at` on every row — evidence: `apps/worker/src/sources/vci.ts` (every bar goes through `normalizeDailyBar`; no unit math, only strict digit-string→number and `t`→`vnDateOf`); `vci.test.ts › name is vci-public`, `› maps chart-ok.json …`, `› t at 17:00 UTC … and 00:00 UTC …`, `› wrapped {data:[...]}`, `› chart-malformed.json …`, `› duplicate trade date …`, `› unequal arrays …`, `› empty root …`, `› other symbol …`, `› bars outside [from, to] …`; `eod-sync.test.ts › runEodSync with VciPriceSource › writes source=vci-public and the run fetched_at on every row` — all pass.
- [x] AC2 Source selected by configuration; TCBS still available; no fallback chaining — evidence: `config.ts` `PRICE_SOURCE_IDS`, `EOD_SYNC_CONFIG.priceSource`; `select-price-source.ts` (single switch, no fallback loop); `cli.ts` EOD branch uses `createPriceSource(args.source ?? c.priceSource, …)`, no direct `new …PriceSource`; `select-price-source.test.ts` (4) and `cli.test.ts › --source` (3) pass.
- [x] AC3 Polite client, honest UA, no circumvention; orchestrator header hard rule — evidence: `http.ts` builds headers internally (`User-Agent`, `Accept`, plus `Content-Type` for POST only), no caller-supplied headers option; `vci.test.ts › sends POST … exactly User-Agent, Accept, Content-Type` (`toEqual` on full header object) and `http.test.ts › postJson headers are exactly …`; `VCI_CONFIG.userAgent` = `stoktok/0.1 (…)`; grep of the `apps/` diff for origin/referer/mozilla/chrome/cookie/sec-/x-requested finds only docs/comments stating the prohibition; 403 → non-retryable `blocked by source (HTTP 403)`, one call (`vci.test.ts › HTTP 403 …`).
- [x] AC4 `worker:eod`, `--dry-run`, `--backfill` unchanged — evidence: `jobs/eod-sync.ts`, `sources/price-source.ts`, `sources/tcbs.ts` not in the diff; `eod-sync.test.ts › re-run is idempotent; requestsMade = symbols x chunks` and `› 403 on every symbol … breaker` pass; existing eod-sync/cli/http/tcbs tests pass unchanged; `config.test.ts` span invariant passes; `vci.test.ts › range longer than maxCalendarDaysPerRequest` (no fetch).
- [x] AC5 ADR documents unit, date encoding, raw vs adjusted, terms; wrong units rejected — evidence: `docs/adr/0004-vci-eod-price-source.md` (all planned sections incl. Header policy, UNVERIFIED, first dry-run checklist); amendment line in `docs/adr/0001-eod-price-source.md:5`; `vci.test.ts › chart-thousand-vnd.json -> every bar rejected`.
- [x] AC6 Fixtures + no-network only; checks green — evidence: `apps/worker/test/fixtures/vci/README.md` labelled SYNTHETIC; all VCI tests inject `fetchImpl`; `vci.test.ts › global fetch is blocked in tests`; checks above.

### Scope
All product/test/doc files are in the plan's file list. `work/**` changes (ticket, plan, consults, backlog, STK-039 split ticket) are orchestrator artifacts. No unjustified out-of-plan changes.

### Issues
None.

### Rules R1–R10
No violations found. R1/R2: no unit conversion or rounding outside core. R3: worker-only code. R4: `source`/`fetched_at` stamped by unchanged `runEodSync`; shape/mismatch/truncation errors throw instead of storing partial data. R5: source id, URL, UA, span cap in `config.ts`. R6 suspended. R7: within plan. R8: green; no core change. R10: public read-only market data, no brokerage login.

### Nits (do not block)
- `eod-sync.test.ts` VCI block builds the response inline from the request body instead of a JSON fixture (justified in impl-log: dates must follow the run's target date).
- `http.test.ts` postJson test asserts the 403 message is exactly `HTTP 403`, which implies the body isn't included, but no test sends a body-bearing error response.
- ADR 0004 says "Status: accepted (Ming, 2026-11-01)"; Ming approved the plan, so this is accurate in substance.

### Follow-ups (out of scope)
- First live `--dry-run --source vci-public` on the home server; work through the ADR 0004 checklist and update the UNVERIFIED list.
- Replace synthetic fixtures with a sanitized real capture.
- Symbol batching; decide on a `--backfill` rewrite of TCBS-era rows if VCI prices turn out adjusted (Ming).
