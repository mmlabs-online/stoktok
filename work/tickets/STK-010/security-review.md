## Security review: STK-010, attempt 1 (settings screen)

**Verdict: no blocking findings. 0 🔴, 2 🟡, 3 💭.** Static read only. I ran no code and made no edits.

### Checked and clean
- **FormData re-validation, no mass assignment**: `apps/web/server/settings/handlers.ts:17-29` reads exactly 9 named keys as strings, so any extra fields are ignored. `validateSettingsInput` (`packages/core/src/settings/validate-settings.ts:100-142`) bounds every field. `cashDividendTreatment` is checked against a whitelist (`:124`). The validated object is built field by field (`:131-140`), never spread from input.
- **Upsert payload**: `settingsInputToRow` (`packages/core/src/db/mappers.ts:215-229`) is an explicit literal with `id: 1` hard-coded and only known columns. The DB also enforces `check (id = 1)` and `rule_configs` must be a JSON object (`supabase/migrations/20261023000100_v1_tables.sql:64,73`). `saveAppSettings` passes nothing else (`packages/db/src/repos/settings.ts:110-119`).
- **rule_configs merge / prototype pollution**: `mergeRuleConfigs` (`packages/core/src/settings/market-rules.ts:44-56`) uses object spread, which copies even an own `__proto__` key from JSON as a plain key and never changes the prototype. No recursive merge, no `Object.assign` into a shared target, no key lookups driven by input. Only the `market` namespace is rewritten; other namespaces (e.g. `signals`) are kept. The values written are validated integers, not user strings. `parseMarketRules` (`:29-41`) reads fixed keys and falls back to defaults if a value is not a positive safe integer.
- **Error leakage**: on a `DataError`, the client gets only the `SAVE_FAILED` code plus the Vietnamese message (`handlers.ts:38-41`). Other errors are rethrown, and Next.js hides those in production (the client sees only a digest).
- **Redirect**: fixed path `redirect('/settings?saved=1')` (`actions.ts:15`), no user-controlled target. `page.tsx:19` only compares `saved === '1'`.
- **Service key**: `apps/web/server/db.ts:1` has `import 'server-only'`. `settings-form.tsx:7-8` uses type-only imports from `server/`, which are removed at build. No `SERVICE_ROLE` string in the existing `apps/web/.next/static` (the build may be stale). The implementer reports `check:service-key` passing with 0 hits.
- **Parser / ReDoS**: `RATE_RE` `^(\d+)(?:[.,](\d+))?$`, `PLAIN_RE` and `GROUPED_RE` (`packages/core/src/entry/parse-input.ts:5-6,25`) have no ambiguous nesting, so matching time is linear. `\d` is ASCII-only (no `u` flag). Negative input is rejected before the regex runs. More than 4 fraction digits are rejected, never rounded. The max check runs on the BigInt before `Number()`, so no precision is lost (R2).

### Findings
- 🟡 **No length cap before `BigInt()`**: `parse-input.ts:16` and `:39`. A string of several hundred KB of digits passes the regex and goes into `BigInt(...)`. Turning a very long digit string into a BigInt is expensive (worse than linear), and that cost is paid before the bound check. The server-action body limit (1 MB by default) caps it. With R6 suspended, though, anyone who can reach the server can send this request (see Risks). Fix: return `TOO_LARGE` when the input is longer than about 20 characters, before any BigInt work. Add one unit test. Same pattern in `parseIntegerInput`, so it also covers transactions.
- 🟡 **The existing row is merged without validation**: `settings.ts:113` passes the raw `existing` row into `settingsInputToRow`. Values carried over (`dividend_withholding_rate_ppm`, `cost_method`, `holidays`) skip `appSettingsFromRow`. The DB constraints mostly cover this: `holidays` is `not null`, and `rule_configs` must be an object. The row is also mapped on the way back (`:118`). So this is defence in depth, not an exploit. If a bad row ever exists, though, the save writes it back before the read-side mapper throws. Consider running `mapRow(appSettingsFromRow, existing)` first, or accept and note it. The atomicity question is already follow-up F3.
- 💭 **Raw input echoed back**: `handlers.ts:34` returns the raw `values` to the submitter on validation errors. React escapes it, so there is no XSS. It just means a huge field (as above) is sent back in full. The length cap fixes this too.
- 💭 **Read-side mapper message**: `mappers.ts:194,196` puts the stored value into the `RowMappingError` message. It only goes to server logs (Next masks it on the client), so it does not reach the browser. Fine as is.
- 💭 **No CSRF check of our own**: the server action relies on Next's built-in Origin/Host check. That is fine behind Cloudflare Tunnel as long as the Host header passes through unchanged. Do not add `serverActions.allowedOrigins` wildcards.

### Recommendations
1. Add the length cap in `parse-input.ts`: one small edit plus a test. It falls under AC2 (invalid values are rejected by core validation) and R2.
2. Optionally validate `existing` before merging, or log it as a follow-up under R7.

### Risks
- **R6 suspended (not blocking, per CLAUDE.md)**: `saveSettingsAction` has no auth. Anyone who reaches the app can change fee, tax, settlement and lot-size rules, which corrupts P&L and sellable-quantity results for Ming's portfolio. That is acceptable only while the app stays on the LAN. Before STK-018 go-live, either restore R6 (STK-004) or put the subdomain behind Cloudflare Access. The `requireUser()` insertion point is already marked (`actions.ts:9`, `handlers.ts:10`).

### Open questions
- None blocking. Is the `.next/static` build current for this diff? A fresh build plus a grep for `SERVICE_ROLE` would confirm R3 for this attempt's bundle.
