# Security review: STK-033

## Attempt 1. Verdict: no blocking findings 🟢

**Scope:** I couldn't run `git diff origin/main...HEAD` because I only have read/grep tools, no shell. I worked from the file list in `impl-log.md` and read the changed files directly:
- `/home/user/stoktok/apps/web/server/settings/handlers.ts`
- `/home/user/stoktok/packages/core/src/settings/signal-rules-form.ts`
- `/home/user/stoktok/packages/core/src/settings/validate-settings.ts`
- `/home/user/stoktok/packages/core/src/settings/read-fields.ts`
- `/home/user/stoktok/packages/core/src/db/mappers.ts`
- `/home/user/stoktok/packages/core/src/signals/config.ts`
- `/home/user/stoktok/packages/db/src/repos/settings.ts`
- `/home/user/stoktok/apps/web/components/settings/settings-form.tsx`

Missing auth was not checked (R6 is suspended).

### Findings

**🟢 1. Input validation before the DB write passes**
- `handlers.ts:17-47` reads a fixed list of 27 named keys. Any other FormData fields are ignored, and a File value just becomes the string "[object File]", which then fails validation.
- `handlers.ts:51-52`: if validation fails, the handler returns before `saveAppSettings` is called. Tests cover this ("nothing is written").
- `signal-rules-form.ts:171-184`: all 14 numeric signal fields are required and range-checked against `SIGNAL_RULE_BOUNDS`.
  - Integers go through BigInt and are capped at the field max and `MAX_SAFE_INTEGER`.
  - Percents only accept the strict regex `^(\d+)(?:[.,](\d+))?$`, allow at most 4 fraction digits, and are converted to integer ppm with no floats (R2 holds).
- Cross-field rules are enforced at `:187-192`: minConsecutive ≤ comparisons, and short MA < long MA.
- Toggles are a strict `=== 'on'` check, so they can only produce a boolean.

**🟢 2. Write and read bounds match**
- The form validator and `parseSignalRules` (`config.ts:54-61, 91-137`) use the same `SIGNAL_RULE_BOUNDS`, including the `{min:1, max:8}` bound for minConsecutive.
- So any value that passes validation is read back unchanged. Nothing silently falls back to a default after saving.
- Stored JSON that someone edits by hand is still clamped back to defaults when read.

**🟢 3. The rule_configs merge has no clobbering and no key injection**
- `mergeSignalRules` (`signal-rules-form.ts:255-274`) keeps `market`, the other signal horizons, and unknown medium keys. Each of the 5 sections it writes only receives keys from the validated `SignalRules` object. No key comes from user input.
- `mergeRuleConfigs` (`market-rules.ts:44-56`) runs first in `settingsInputToRow` (`mappers.ts:231-234`). It keeps `signals`, and `mergeSignalRules` keeps `market`. This meets acceptance criterion 3.
- Prototype pollution is not possible. The source keys are fixed, and object spread defines own properties, so even a `__proto__` key stored in the DB JSON would not change the prototype.
- There is no SQL built from strings. The write goes through the supabase-js `upsert` with a fixed `id: 1`.

**🟢 4. R3 holds**
- The client component `settings-form.tsx:3-16` imports only constants from `@stoktok/core` and uses `import type` for everything under `server/`, which is erased at build time. It has no DB or service client import.
- `apps/web/server/db.ts:1` has `import 'server-only'` and reads the service key from `process.env` at runtime.
- The only `process.env` use in `apps/web` is that one file, and there is no `NEXT_PUBLIC_*` anywhere.
- `app/(app)/settings/actions.ts` is `'use server'` and calls `getDb()` on the server.

**🟢 5. Minor, informational, not caused by this diff**
- `saveAppSettings` (`packages/db/src/repos/settings.ts:128-137`) reads the row, then upserts it without a transaction or version check. Two saves at the same moment could lose one update to rule_configs. This is negligible for a single user, and the code predates this ticket. Possible follow-up only.
- When validation fails, raw input strings are sent back to the form. React escapes them and they have no length limit, so there is no XSS risk. Not worth changing.

### Recommendations
- None blocking.
- Optional follow-up (R7): if the app ever has more than one writer, make the rule_configs merge atomic, for example with a `jsonb_set` RPC or an optimistic-lock column.

### Risks
- Low. The only new place user input becomes data is the settings form, and it is fully validated and limited to a fixed set of keys.
- Exposing the app publicly without auth (STK-018) would let anyone change the signal rules. That is the known R6 decision, not a finding against this ticket.

### Open questions
- None.
