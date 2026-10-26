## Security review — STK-015 attempt 1 (medium-term signals)

I couldn't run commands (no shell), so I didn't run `git diff main...HEAD`. I reviewed the files listed in impl-log.md directly at HEAD. Overall verdict: **no 🔴 findings.** Access control, the upsert payload, config parsing and secret handling are sound. There are two 🟡 robustness issues in the integer (ppm) math.

### Findings

**🟡 1. Unguarded `mulDiv` in the growth rule: one bad financials row aborts the whole run**
- Location: `/home/user/stoktok/packages/core/src/signals/growth.ts:39` (also `:32`).
- `mulDiv(cur.netIncome - base.netIncome, PPM, base.netIncome)` is not wrapped in try/catch. The valuation rule catches the same error at `valuation.ts:111-119`, and `safeRatioPpm` does too.
- How it breaks: `financials.revenue >= 0` allows 0 (`20261026000100_financials.sql:9`). With revenue 0, the `minBasePpmOfRevenue` guard becomes `>= 0`, so any tiny positive base (e.g. 1 VND) passes. A large current net income then gives a ppm result above `MAX_SAFE_INTEGER`, and `toSafe` throws `RangeError`.
- `evaluateMediumSignals` has no per-rule catch, so `runMediumSignals` throws and **nothing is upserted**. The data comes from an untrusted source (TCBS), so this is a data-driven way to stop the job. It fails closed (no wrong signals), but no signals are written.
- Fix: wrap it like valuation and push `value_out_of_range`, or require `revenue > 0` for `baseOk`. Add a unit test with revenue 0, base 1, and a very large current net income.

**🟡 2. Unguarded division in the moving-average rule when the MA is 0**
- Location: `/home/user/stoktok/packages/core/src/signals/moving-average.ts:27-28`.
- `prices_daily.close` may be 0 (`low >= 0`, and the mapper only rejects `< 0`, `mappers.ts:49`). If every close in the window is 0, or the closes are so small the MA rounds to 0, `mulDiv(..., ma)` throws `RangeError('denominator must be positive')`. Same effect: the whole run aborts.
- Fix: `if (ma <= 0) reasons.push('value_out_of_range')`, plus try/catch around `mulDiv`. Add a test.

**💭 3. No size bound on the snapshot in app code; the DB check is the only limit**
- Location: `/home/user/stoktok/supabase/migrations/20261026000200_signals.sql:30`.
- `pg_column_size <= 32768` is the only bound. The valuation snapshot lists all `peers` and `excluded` in the sector (`valuation.ts:140-141`), so its size grows with the watchlist plus held symbols. Small today.
- If one row ever goes over, the whole 500-row chunk fails. Earlier chunks are already written, so the run is left partial.
- Option: cap or trim `peers`/`excluded` in core (as `MISSING_DATES_LIMIT` does), or add a `rejects_bad_rows` case for the size check. The size check currently has no db:check test.

**💭 4. `reason_codes` is checked for format only, not against the reason list**
- Location: `signals.sql:25-29`.
- The check enforces the `[a-z0-9_]` format, not the actual codes in `REASON_ORDER`. An element containing a comma (`'a,b'`) also passes as two codes.
- Harmless: only the worker writes this table. Hard-coding the list into the check would break when a code is added, so this is acceptable as is.

**💭 5. Re-runs overwrite the audit snapshot**
- The upsert updates `inputs_snapshot` and `computed_at` in place, so an earlier run's audit record for the same day is lost. Already in the follow-ups as "immutable cited ok rows". This is not a security issue.

### What I verified (no finding)
- **Migration and RLS** (`signals.sql:39-43`):
  - RLS is enabled with no policies.
  - Table and sequence are revoked from anon and authenticated, and granted only to service_role.
  - The checks enforce the label list and its pairing with `status`, the `ok`/`suppressed` structure, `data_fresh`, and that `inputs_snapshot` is a JSON object.
  - Rollback is a single `drop table`; the identity sequence goes with it.
- **`/home/user/stoktok/scripts/db-check/checks.sql`:** the global checks cover `signals`: `rls_enabled_all_tables`, `no_policies`, `no_grants_anon_authenticated_public` (including PUBLIC and sequences), and `anon_`/`authenticated_denied`. The new cases (`:130-140`, `:232-247`, `:288-303`) test the constraints, plus that an upsert keeps the same id.
- **Upsert payload:** built field by field at `/home/user/stoktok/apps/worker/src/jobs/medium-signals.ts:112-125` and matches `SignalInsert` exactly (`rows.ts:93-106`). `id` and `created_at` are never sent. `/home/user/stoktok/packages/db/src/repos/signals.ts:16-19` de-duplicates on the conflict key.
- **`parseSignalRules`** (`/home/user/stoktok/packages/core/src/signals/config.ts:63-137`):
  - Reads only fixed key names and builds a new object; it never spreads or merges the input. A JSON `__proto__` key becomes an own property and is never read, so there is no prototype pollution.
  - Numbers must be safe integers within bounds, so `1e308`, NaN, floats and numeric strings all fall back to defaults. Booleans must be real booleans.
  - The short/long MA pair and comparisons/minConsecutive fall back to defaults together when inconsistent.
  - MA days are capped at 250, which also caps the `getRecentCloses` read and the snapshot's `closes` array.
- **Snapshot contents:** refs (`table:symbol:date`), `source`, `fetchedAt`, rule params, closes and ratios. No secrets and no env values.
- **Service key:** only read in `packages/db/src/client.ts:9-10`; the error message names the missing variable without its value. `cli.ts` logs only `e.message` and the summary JSON, and the summary has no config or env. No logging of the key anywhere.
- **No network calls:** the `signals` branch in `/home/user/stoktok/apps/worker/src/cli.ts:37-44` builds no source and no `fetch`. `medium-signals.ts` imports only core and db plus a constant from `financials-sync.ts`, which has no import-time side effects.
- **Other repos:** `listSymbolSectors` and `listOpenMarketGaps` select fixed columns with parameterised `.in`/`.eq`/`.is` filters. Symbols are normalised first and the DB symbol regex rules out keys like `__proto__` in `out[row.symbol]`.
- **Other ppm math:** valuation uses `safeRatioPpm` plus a guarded `mulDiv`, and `medianInt` uses BigInt. These paths are safe.

### Recommendations
- Fix 🟡1 and 🟡2 before PASS. They come under R8 (edge-case tests for new core logic) and AC1 (edge cases), and both are one-line guards with a test each.
- 💭3 to 💭5 are optional or follow-ups.

### Risks
- Until 🟡1 and 🟡2 are fixed, one malformed upstream row can stop all signal output for the day (fails closed, no partial wrong data).

### Open questions
- None.
