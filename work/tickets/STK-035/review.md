## Attempt 1 — 2026-10-31
Verdict: PASS

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0 (core, db, web incl. route types, worker).
- lint: `pnpm lint` exit 0 (all packages).
- test: `pnpm test` exit 0. core 39 files / 474 passed; db 14 files / 117 passed + 1 todo; worker 8 files / 94 passed; web 25 files / 214 passed (includes `no-calc-in-ui` and `no-hardcoded-rules`). Matches impl-log.md.
- Extra reviewer check (scratch test, outside the repo): fed real `evaluateMediumSignals` output for a 6-symbol sector universe (250 closes, 12 quarters), JSON round-tripped, into `presentMediumSignals`. All 5 default rules came out as `ok` rows with correct value text, every price/financials/sector input showing source and "Cập nhật", and the MA window line. So real worker snapshots parse and don't get dropped as `snapshot_invalid`.

### Acceptance criteria
- [x] Medium-term signals with their inputs (each cited ref shows source and fetched_at); labels are directions only. Evidence: `present.ts` `inputOf`/`inputsOf`, `visibility.ts` `parseRef` (a provenance ref without source/fetchedAt → `snapshot_invalid`), `present.test.ts › direction, value text and one input per cited ref…`, `› MA row adds a window summary line…`, `visibility.test.ts › prices_daily/financials/symbols ref without source or fetchedAt -> snapshot_invalid`, `labels-vi.test.ts › no label contains an action word` (+ self-check that the scan catches a bad label), `signals-section.test.tsx › ok row renders … "Nguồn:" and "Cập nhật"`, `› no action words in the rendered section`. The gap/corporate-action waiver (plan D3) is applied as planned.
- [x] Hidden with explanation + last signal date when stale; decided in core with unit tests. Evidence: `visibility.ts` `signalVisibility` (signal_outdated, per-rule price/financials gap windows, rule version, invalid snapshot; stale outranks suppressed); `visibility.test.ts` staleness/cutoff/holiday/gap-window/precedence cases; `present.test.ts › all rows hidden -> section kind 'hidden'…`; `load-symbol.test.ts › signals hidden when signal_date < expected date`, `› financials gap … hides the P/B row`; `signals-section.test.tsx › hidden state shows "Tín hiệu gần nhất"…`.
- [x] Suppressed rows show Vietnamese reasons from an exhaustive label map. Evidence: `labels-vi.ts` `REASON_LABELS … satisfies Record<ReasonCode, string>` (typecheck green), `labels-vi.test.ts › every REASON_ORDER code has a non-empty Vietnamese label without "_"`, `› reasonLabel: unknown code -> "Lý do khác (<code>)"`, `signals-section.test.tsx › suppressed row lists each Vietnamese reason as <li>, never the raw code`.
- [x] New db read `listLatestSignals` with tests; disclaimer shown. Evidence: `packages/db/src/repos/signals.ts` `listLatestSignals`, `signals.test.ts › listLatestSignals` (query shape, omitted rule, empty ids, string bigint, mapping errors, passthrough, DB error); `signals-section.tsx` renders `<DisclaimerNote>` in every state; `signals-section.test.tsx › DISCLAIMER_TEXT present in empty, hidden and list states`.

### Issues
None.

### Scope
Every changed product file is in the plan's file list. Other changes are workflow files only (backlog.md, ticket.md, consult files, plan.md, impl-log.md). No out-of-plan changes.

### Rules R1–R10
No violations found. R1: all decisions, value wording and sign handling are in `packages/core/src/signals/present.ts`/`visibility.ts`; the component maps strings to markup only. R2: `value`/`rule_version` go through `toSafeInt`; percent text uses `formatPercent`. R3: reads go through `server/db.ts` in `loadSymbol`; the component imports only types from core. R4: rows whose refs lack provenance are hidden; open gaps hide affected rows. R5: MA days, comparisons and publish lag come from settings/core config. R6: suspended, no auth added (correct). R8: new core logic has unit tests. R9/R10: direction labels only, banned-word tests in place.

### Nits (do not block)
- `signals-section.tsx` input `<li>` key is `${kindLabel}|${refText}`. Two `data_gaps` refs covering the same dates would collide (React warning only). Adding an index or the raw ref would fix it.
- `presentMediumSignals` parses the snapshot a second time after `signalVisibility` already parsed it. This is harmless; the `!snap.ok` branch there can't be reached.
- No in-repo test feeds real `evaluateMediumSignals` output through `presentMediumSignals`. The reviewer's scratch check passed, but a contract test would catch snapshot-shape drift between the worker and web.

### Follow-ups (out of scope)
- Contract test: `evaluateMediumSignals` output → JSON → `presentMediumSignals` gives no `snapshot_invalid` (see the nit above).
- The plan's follow-ups stand: peer-gap check (D4), ratio/median display (D9), corporate-action ref provenance (D3), softer "waiting" wording (D1).
