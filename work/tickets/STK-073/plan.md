Status: READY

# Plan — STK-073: AI wiring and AI usage card (STK-063 slice 3b)

## Spec summary
- spec-v1 §6.1: "**LLM** writes the summary and explanation from the stored inputs only." This ticket only wires the client; no AI job and no prompt (STK-064–066).
- spec-v1 §7: "Secrets (Supabase keys, LLM API key) only in the deploy repo's env handling, never in the app repo." Keys are read only by `readAiEnv` (`packages/ai/src/env.ts`) at runtime. They are never inlined into a bundle.
- spec-v1 §9 open question 6 (LLM provider) was resolved by STK-063: Anthropic + Google, with cap and warn level in `AI_CONFIG.budget` (`capMicroUsd: 5_000_000, warnPpm: 800_000`, `packages/core/src/ai/config.ts:56`).
- CLAUDE.md R1: "No financial calculation in UI." R3: "Service role key is server-only … never in client bundles. The browser never talks to the DB directly." R5: market rules (here the AI budget) are configuration. R6: "Every server route / server action verifies the Authen JWT (`requireUser()`)."
- Ticket ACs 1–6 and the carry-overs (one `timeoutMs`, the bundle check covers both SDKs, the SDK env vars `ANTHROPIC_CUSTOM_HEADERS` / `GOOGLE_GENAI_API_VERSION`).

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | `aiUsageLedger(db)` in `packages/db` binds `reserveAiUsage` / `settleAiUsage` / `getAiMonthSpend` to `db`. Errors pass through unchanged, so `pgCode` survives. | `packages/db/src/repos/ai-usage.test.ts › aiUsageLedger › reserve passes a 22023 DataError through with pgCode intact` (the same error instance, `instanceof DataError`, `pgCode === '22023'`). `› binds reserve, settle and monthSpend to db`. Typecheck proves the structural match: `server/ai.ts` passes the result as `UsageLedger`. |
| 2 | `apps/web/server/ai.ts`: line 1 is `import 'server-only';`. It is the only `apps/web` importer of `@stoktok/ai` and gets db access from `./db`. The client is built lazily (nothing runs at module top level) and works with no AI keys. r3-guard pins line 1. Worker: an `apps/worker/src/ai.ts` factory with a unit test, and no job. | `r3-guard.test.ts › apps/web/server/ai.ts exists, starts with import 'server-only' and imports from './db'` and the existing importer test. `apps/web/server/ai.test.ts › importing the module does not call getDb or build providers` and `› getAiBudgetStatus with no AI keys returns budgetStatus of the ledger's month spend`. `apps/worker/src/ai.test.ts › createWorkerAi with env {} builds a client whose budgetStatus reads ai_month_spend`. `apps/worker/src/cli.ts` is unchanged (`git diff --stat`). |
| 3 | `next.config.ts`: `@stoktok/ai` is in `transpilePackages` and both SDKs are in `serverExternalPackages`. The SDKs are direct `apps/web` dependencies at the same exact versions. Verified by running the built server or image (see "Runtime verification" below). | Read `next.config.ts` and `apps/web/package.json`. `packages/ai/src/adapters/sdk-pins.test.ts › web, worker and ai package.json pin identical exact SDK versions`. Runtime: the standalone probe command below prints `ok`, and the `.next/server` grep shows a `require` of the SDKs that is not bundled; the impl-log contains both outputs. In CI, the `images` job runs the new probe step in `scripts/check-image.sh` (web). |
| 4 | `check-no-service-key-in-client.sh` builds with AI-key sentinels and fails on the sentinels, the key names, the SDK package names or the SDK API hostnames in `.next/static`. | `pnpm check:service-key` passes and prints a `hits for …: 0` line for each of the 9 needles. Negative test: `mkdir -p /tmp/x && echo api.anthropic.com > /tmp/x/a.js && bash scripts/check-no-service-key-in-client.sh --scan-only /tmp/x` exits 1. Repeat with `ANTHROPIC_API_KEY` and `@google/genai`. |
| 5 | Settings shows a read-only "Chi phí AI tháng này" card outside the form, with spent / cap, remaining and month. It shows a warning at the configured warn level, a refusal state at 100%, and an error state (no false zero) when the spend can't be read. All numbers come from core (`budgetStatus`, `formatUsdMicro`, `aiMessage`, and the new `aiBudgetMeter`). The warn mark comes from config. The meter is accessible and colour is never the only cue. | `packages/core/src/ai/budget.test.ts › aiBudgetMeter …` (79 / 80 / 100 / 120 %, a non-round warnPpm, and the VN month label at the UTC month edge). `apps/web/components/settings/ai-usage-card.test.tsx` covers 0 / 3,999999 / 4,00 / 5,00 / 6,00 USD and the error case. `apps/web/server/ai-budget.test.ts` covers the load failure and the read failure. In `settings/page.tsx` the card is a sibling *above* `<SettingsForm>`, not inside it. |
| 6 | `typecheck`, `lint`, `test` and the client-bundle check are green. | `pnpm typecheck && pnpm lint && pnpm test && pnpm check:service-key`. `pnpm-lock.yaml` is committed and `pnpm install --frozen-lockfile` succeeds. |

### Runtime verification ("verified by running the built server or image") — decision
Docker is **not** available in this sandbox (`docker info` fails), so the image cannot be run here. The criterion is met in two parts:
1. **Local proof, required for PASS.** The implementer runs the following and pastes the output into `impl-log.md`. The reviewer re-runs it.
   ```bash
   pnpm --filter @stoktok/web build
   cd apps/web/.next/standalone/apps/web && node -e "Promise.all([import('@anthropic-ai/sdk'),import('@google/genai')]).then(()=>console.log('ok'),e=>{console.error(e.code||e.message);process.exit(1)})"
   grep -rlE "require\(\"@anthropic-ai/sdk\"\)|require\(\"@google/genai\"\)|\"@anthropic-ai/sdk\"|\"@google/genai\"" apps/web/.next/server | head
   ```
   The probe must print `ok`, run from the same directory the standalone server runs in. The grep must find at least one server chunk that references the package name as an external `require`/import, which shows the SDKs were not inlined. Optional extra: start `node apps/web/.next/standalone/apps/web/server.js` with dummy `SUPABASE_*` env and confirm `/healthz` returns 200 with no `MODULE_NOT_FOUND` in the output. This does not load the Settings module, because `proxy.ts` redirects first, so it adds little.
2. **Authoritative proof in CI.** `scripts/check-image.sh` (web branch) gains a step that runs the same import probe inside the built image (`docker exec -w /app/apps/web "$NAME" node -e …`) and fails with `::error::`. CI's `images` job runs it on the PR. The reviewer may PASS on the local proof plus the script diff. The PR description must state that the image probe runs only in CI. A red CI image job on the PR becomes a REWORK.

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `apps/web/Dockerfile` | `deps` stage: add `COPY packages/ai/package.json packages/ai/`. | AC3. Without it the image install skips the `packages/ai` deps and `--frozen-lockfile` may fail (architect delta Finding 1). |
| `apps/worker/Dockerfile` | The same COPY line. | The worker now depends on `@stoktok/ai`, so the same install problem applies. |
| `apps/web/package.json` | Add `@stoktok/ai: workspace:*`, `@anthropic-ai/sdk: 1.7.0`, `@google/genai: 3.0.0`, all exact. | AC2, AC3 |
| `apps/worker/package.json` | Add the same three dependencies. | AC2 (worker factory); tsup keeps the SDKs external (delta Finding 2). |
| `apps/worker/tsup.config.ts` | Add `'@stoktok/ai'` to `noExternal`. | It ships `.ts` source, so it must be bundled (delta Finding 2). |
| `pnpm-lock.yaml` | Lockfile update. | AC6 (frozen-lockfile in CI and Docker). |
| `packages/db/src/repos/ai-usage.ts` | Add `aiUsageLedger(db)`, which returns `{ reserve: (r) => reserveAiUsage(db, r), settle: (id, s, now) => settleAiUsage(db, id, s, now), monthSpend: (w) => getAiMonthSpend(db, w) }`. No try/catch and no `@stoktok/ai` import. | AC1 |
| `packages/db/src/repos/ai-usage.test.ts` | Add the `aiUsageLedger` tests. | AC1, R8 |
| `packages/db/src/index.ts` | Export `aiUsageLedger`. | AC1. It reaches web via `server/db.ts`'s `export *`. |
| `packages/db/src/r3-guard.test.ts` | (a) a new test that `apps/web/server/ai.ts` exists, starts with `import 'server-only';` and matches `from '\./db'`; (b) an `import\s+` side-effect branch in the SDK regex; (c) a new test that the SDK regex catches `from`, `import()`, `require()` and `import '…'` forms. | AC2, architect delta Finding 3 |
| `apps/web/server/ai.ts` | New, see Approach step 3. | AC2 |
| `apps/web/server/ai.test.ts` | New. | AC2 |
| `apps/web/server/ai-budget.ts` | New: `import 'server-only'`, `readAiBudget(load = () => import('./ai'))` → `{ ok: true; status: BudgetStatus } \| { ok: false }`. This is a soft-fail wrapper (Approach step 7). | AC5 (error state, no false zero) |
| `apps/web/server/ai-budget.test.ts` | New. | AC5 |
| `apps/worker/src/ai.ts` | New: `createWorkerAi({ env?, db? })`. | AC2 |
| `apps/worker/src/ai.test.ts` | New. | AC2, R8 |
| `apps/web/next.config.ts` | `transpilePackages: ['@stoktok/core', '@stoktok/db', '@stoktok/ai']` and `serverExternalPackages: ['@anthropic-ai/sdk', '@google/genai']`. | AC3 |
| `packages/ai/src/adapters/sdk-pins.test.ts` | Add a test that reads `packages/ai`, `apps/web` and `apps/worker` `package.json` and asserts that the two SDK versions are identical, exact (`/^\d+\.\d+\.\d+$/`) and present in all three. | AC3 |
| `scripts/check-no-service-key-in-client.sh` | AI sentinels in the same build call, 6 new needles, and a `--scan-only <dir>` mode (Approach step 6). | AC4 |
| `scripts/check-image.sh` | Web branch: an SDK import probe inside the container. | AC3 (CI half of runtime verification) |
| `packages/core/src/ai/budget.ts` | Add `aiBudgetMeter(status, now, cfg = AI_CONFIG)`. | AC5, R1, R5 |
| `packages/core/src/ai/budget.test.ts` | Tests for `aiBudgetMeter`. | R8 |
| `packages/core/src/ai/index.ts` | Export `aiBudgetMeter` and the `AiBudgetMeter` type. | AC5 |
| `apps/web/components/settings/ai-usage-card.tsx` | New server component (no `'use client'`). | AC5 |
| `apps/web/components/settings/ai-usage-card.test.tsx` | New, uses `renderToStaticMarkup`. | AC5 |
| `apps/web/app/(app)/settings/page.tsx` | Call `readAiBudget()` and `nowInstant()`, and render `<AiUsageCard>` above `<SettingsForm>`. | AC5 |

No other file. In particular: no change to `settings-form.tsx` (the card duplicates the one-line `cardClass`), to `cli.ts`/`index.ts` in the worker, to `packages/ai/src/**` (other than the pins test), or to the deploy repo.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `packages/db/src/repos/ai-usage.test.ts › aiUsageLedger › binds reserve, settle and monthSpend to db` | One rpc/update call each through the fake client, with the same results as the direct repo functions. AC1 |
| `… › aiUsageLedger › reserve passes a 22023 DataError through with pgCode intact` | The fake responds `{ error: { code: '22023' } }`. The rejection is `instanceof DataError` with `pgCode === '22023'`. AC1 |
| `… › aiUsageLedger › monthSpend errors propagate (no zero)` | An error on `ai_month_spend` rejects; it does not resolve 0. AC1/AC5 |
| `packages/db/src/r3-guard.test.ts › apps/web/server/ai.ts exists, starts with import 'server-only' and imports from './db'` | AC2 |
| `… › SDK regex catches from, import(), require() and side-effect import` | Delta Finding 3 |
| `apps/web/server/ai.test.ts › importing the module does not call getDb or build providers` | `vi.mock('server-only')` and `vi.mock('./db')` with a `getDb` spy, then `import('./ai')`; the spy has not been called. AC2 (lazy) |
| `… › getAiBudgetStatus with no AI keys returns budgetStatus of the ledger's month spend` | Fake db whose `rpc('ai_month_spend')` returns 4_000_000 → `{ percent: 80, level: 'warn', … }`. No key env is set or named. AC2 |
| `… › getAi returns the same instance on repeated calls` | Singleton. |
| `apps/web/server/ai-budget.test.ts › ok: returns { ok: true, status }` | AC5 |
| `… › load failure (module throws MODULE_NOT_FOUND) → { ok: false }` | The injected loader rejects. AC5, architect delta Risk "one missing module breaks all of Settings" |
| `… › read failure (DataError 22023 / DB_ERROR) → { ok: false }, and the warn log has a code only` | No message or `pgCode` text in the return value. AC5 |
| `apps/worker/src/ai.test.ts › createWorkerAi with env {} builds a client whose budgetStatus reads ai_month_spend` | An injected fake `db` (`{ rpc }`) and `env: {}`. Asserts the rpc name and the returned status. No key or service-role names in the file (r3-guard). AC2 |
| `packages/ai/src/adapters/sdk-pins.test.ts › web, worker and ai package.json pin identical exact SDK versions` | AC3 |
| `packages/core/src/ai/budget.test.ts › aiBudgetMeter › fill = percent below cap; clamped to 100 above (120 → 100)` | Uses `budgetStatus(3_999_999)` (79), `4_000_000` (80), `5_000_000` (100) and `6_000_000` (120 → 100). R1 |
| `… › warnPercent comes from cfg.budget.warnPpm (800_000 → 80, 805_000 → 80.5)` | R5 |
| `… › monthLabel is the VN month: 2026-11-30T17:00Z → "12/2026", 2026-11-30T16:59:59.999Z → "11/2026"` | The month edge in UTC versus VN time (UI consult rec 3). |
| `apps/web/components/settings/ai-usage-card.test.tsx › ok at 0` | "0,00 USD", "5,00 USD", "Còn lại", "Trong hạn mức", `aria-valuenow="0"`, tick `left:80%`. |
| `… › ok at 3_999_999` | Shows "79%" next to "4,00 USD" (ceil display), level text "Trong hạn mức", no warn icon. |
| `… › warn at 4_000_000` | `aiMessage('budget_warn', …)` text, a warn icon (`data-level="warn"` plus the `AlertTriangle` svg), `aria-valuenow="80"`. |
| `… › exhausted at 5_000_000` | The `aiMessage('budget_exhausted', …)` text and a distinct icon. |
| `… › over cap at 6_000_000` | Shows "6,00 USD / 5,00 USD" and "120%", `aria-valuenow="100"`, "Còn lại 0,00 USD". |
| `… › error state` | Error text, `role="status"`; contains no "0,00", no `role="meter"`, and no "pgCode"/"22023". |
| `… › formatUsdMicro output uses the vi-VN separator` | "1,00 USD" for 1_000_000 (ICU check, UI consult Risk 3). This may live in `messages-vi.test.ts` if it is already covered there; check before adding. |

## Approach
Order (architect delta "Size"): Dockerfiles/deps → ledger adapter → `server/ai.ts` + guard → worker factory → next.config + standalone probe → bundle-check script → core meter helper → card.

1. **Dependencies.** Run `pnpm --filter @stoktok/web add -E @stoktok/ai@workspace:* @anthropic-ai/sdk@1.7.0 @google/genai@3.0.0`, and the same for `@stoktok/worker`. Use `--prefer-offline` if the proxy is slow; both versions are already in the store via `packages/ai`. Add the `packages/ai/package.json` COPY line to both Dockerfiles, right after the `packages/db` line. Add `'@stoktok/ai'` to the worker `noExternal`. Commit `pnpm-lock.yaml`.
2. **Ledger adapter (E).** Write `aiUsageLedger(db: Db)` as above. Do not wrap or re-throw errors; `DataError` already keeps `pgCode` (`packages/db/src/errors.ts`). Export it from the index.
3. **`apps/web/server/ai.ts` (F).**
   ```ts
   import 'server-only';
   import { AiClient, buildProviders, readAiEnv } from '@stoktok/ai';
   import type { BudgetStatus } from '@stoktok/core';
   import { aiUsageLedger, getDb } from './db';
   const AI_TIMEOUT_MS = 60_000;
   let ai: AiClient | undefined;
   export function getAi(): AiClient { ai ??= new AiClient({ providers: buildProviders(readAiEnv(), { timeoutMs: AI_TIMEOUT_MS }), ledger: aiUsageLedger(getDb()), log: { warn: (e) => console.warn(JSON.stringify(e)) }, timeoutMs: AI_TIMEOUT_MS }); return ai; }
   export function getAiBudgetStatus(): Promise<BudgetStatus> { return getAi().budgetStatus(); }
   ```
   Nothing else runs at top level. Add a comment that the deploy env must not set the SDKs' `ANTHROPIC_CUSTOM_HEADERS` / `GOOGLE_GENAI_API_VERSION` (carry-over). Do not name the API key variables (r3-guard). Callers must have called `requireUser()` (R6); the Settings page already does. R3: `server-only`, the server is the only DB caller, and the service role is reached only through `getDb()`.
4. **Worker (G).** `apps/worker/src/ai.ts`: `export function createWorkerAi(opts: { env?: Record<string, string | undefined>; db?: Db } = {}): AiClient`. `env` defaults to `process.env` and `db` to `createServiceClient(env)`. It uses the same `AI_TIMEOUT_MS` pattern and a console log adapter. Do not import it from `cli.ts` or `index.ts` (R7, no job).
5. **`next.config.ts` (H).** Add the two keys. Run the local runtime proof (see "Runtime verification") and paste the output into the impl-log. Add the probe to `scripts/check-image.sh` after the `/` probe and before the MODULE_NOT_FOUND log grep:
   ```bash
   if ! docker exec -w /app/apps/web "$NAME" node -e "Promise.all([import('@anthropic-ai/sdk'),import('@google/genai')]).then(()=>process.exit(0),()=>process.exit(1))"; then
     echo "::error::web smoke failed: AI SDKs do not resolve from /app/apps/web"; exit 1
   fi
   ```
6. **Bundle check (I).** In `check-no-service-key-in-client.sh`, generate `AI_A="sk-ant-SENTINEL-$RANDOM$RANDOM"` and `AI_G="goog-SENTINEL-$RANDOM$RANDOM"` and pass them in the existing single build call (`… ANTHROPIC_API_KEY="$AI_A" GOOGLE_AI_API_KEY="$AI_G" pnpm --filter @stoktok/web build`). Extend the needle loop to: `"$SENTINEL" SUPABASE_SERVICE_ROLE_KEY service_role "$AI_A" "$AI_G" ANTHROPIC_API_KEY GOOGLE_AI_API_KEY @anthropic-ai/sdk @google/genai api.anthropic.com generativelanguage.googleapis.com`. Add `--scan-only <dir>`: when given, skip the build and scan `<dir>` with only the fixed needles (no sentinels). This makes the failure path testable without a build. Change the failure message to "secret or AI SDK material found in client bundle". The `.sh` file is not scanned by r3-guard, so naming the keys there is fine.
7. **Soft-fail read.** `apps/web/server/ai-budget.ts`:
   ```ts
   import 'server-only';
   export type AiBudgetRead = { ok: true; status: BudgetStatus } | { ok: false };
   export async function readAiBudget(load: () => Promise<{ getAiBudgetStatus(): Promise<BudgetStatus> }> = () => import('./ai')): Promise<AiBudgetRead> {
     try { return { ok: true, status: await (await load()).getAiBudgetStatus() }; }
     catch (e) { console.warn(JSON.stringify({ event: 'ai_budget_read_failed', code: (e as { code?: unknown })?.code === 'MODULE_NOT_FOUND' ? 'module_not_found' : 'read_failed' })); return { ok: false }; }
   }
   ```
   The **dynamic** import of `./ai` is the deliberate pick between the architect's Options A and B. Settings still exercises the real `AiClient` and SDK-externals path (Option A). A missing external or a construction error is caught and becomes the card's error state, instead of a MODULE_NOT_FOUND for the whole page (the Option B safety). The value `ok:false` carries no message or `pgCode` (UI consult Risk 4).
8. **Core helper (J, R1/R5).** In `budget.ts`:
   ```ts
   export interface AiBudgetMeter { fillPercent: number; warnPercent: number; monthLabel: string }
   export function aiBudgetMeter(status: BudgetStatus, now: Date, cfg: AiConfig = AI_CONFIG): AiBudgetMeter
   ```
   - `fillPercent = Math.min(Math.max(status.percent, 0), 100)`.
   - `warnPercent = cfg.budget.warnPpm / 10_000`. This is exact for an integer ppm, and it is a position, not money, so R2 is not involved.
   - `monthLabel = "MM/YYYY"` from `vnDateOf(now)`.
9. **Card.** `apps/web/components/settings/ai-usage-card.tsx` is a server component (no `'use client'`) with props `{ read: AiBudgetRead; meter: AiBudgetMeter | null }`. It does no arithmetic or comparisons beyond switching on `level` and `ok`.
   - Section with the same classes as `cardClass` (duplicated string), `max-w-2xl`, title h2 "Chi phí AI tháng này" (with an `id` for `aria-labelledby`), and the muted note "Chỉ đọc — hạn mức tính theo tháng (giờ Việt Nam)".
   - Headline: `formatUsdMicro(spent)` / `formatUsdMicro(cap)` with `num`, plus a `{percent}%` label (raw `status.percent`, which may exceed 100).
   - Bar: a `div role="meter"` with `aria-valuemin=0`, `aria-valuemax=100`, `aria-valuenow={meter.fillPercent}` and `aria-labelledby` on the h2. `aria-valuetext` is "Đã dùng {spent} / {cap} ({percent}%)". The track is `bg-border` and the fill `style={{ width: fillPercent + '%' }}`. A tick at `left: warnPercent + '%'` is a 2px `bg-fg` mark marked `aria-hidden`. No transition or animation.
   - Below the bar: "Còn lại {formatUsdMicro(remaining)}" and "Tháng {monthLabel} (đặt lại ngày 1)".
   - Level row with `role="status"`:
     - ok: `CheckCircle2` + "Trong hạn mức", fill `bg-accent`.
     - warn: `AlertTriangle` + `aiMessage('budget_warn', { percent, spentMicroUsd, capMicroUsd })` in `text-warn font-semibold`, fill `bg-warn`.
     - exhausted: `Ban` + `aiMessage('budget_exhausted', { capMicroUsd })` in `text-price-down`, fill `bg-price-down`, with a `price-down-bg` strip.
     - Icons are `aria-hidden`; the text carries the meaning. Each level has a `data-level` attribute for tests.
   - Error (`read.ok === false`): `AlertTriangle` + "Không tải được chi phí AI tháng này. Thử tải lại trang." in `text-warn`, `role="status"`, and no meter or amounts.
   - Inline labels ("Đã dùng", "Còn lại", "Trong hạn mức", the title, the note, the error line) are UI labels as in other components. Warn and refusal texts come only from `aiMessage`.
10. **Page.** In `settings/page.tsx`, after `requireUser()` and alongside `getAppSettings`, add `const ai = await readAiBudget(); const meter = ai.ok ? aiBudgetMeter(ai.status, nowInstant()) : null;` and render `<AiUsageCard read={ai} meter={meter} />` above `<SettingsForm>`. The form props are unchanged.
11. **Checks.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm check:service-key`, the runtime proof (step 5), and the `--scan-only` negative test. Record outputs in the impl-log. Also record `grep -nE 'ANTHROPIC_CUSTOM_HEADERS|GOOGLE_GENAI_API_VERSION' deploy/deployment-repo/apps/stoktok/compose.yml deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` returning nothing (carry-over: the env file is written from a fixed key list, and compose `environment:` sets only `STOKTOK_VERSION`, `HOSTNAME` and `TZ`).

Rules: R1 (all numbers come from core `budgetStatus`/`aiBudgetMeter`/`formatUsdMicro`/`aiMessage`), R3 (`server-only`, the r3-guard, the bundle check with SDK fingerprints, SDKs external), R5 (cap and warn from `AI_CONFIG`), R6 (the page already calls `requireUser()`), R7 (no job, no form refactor), R8 (core and db tests). R9 is unaffected (no generation). R10 is untouched.

## Specialist input used
- **Architect delta Finding 1 (Dockerfile COPY):** adopted. It is an AC3 prerequisite.
- **Delta Finding 2 / Open question 2 (worker deps + `noExternal`):** adopted. Worker-image runtime probe → follow-up for STK-064.
- **Delta Finding 3 (r3-guard additions):** adopted as written, including the existence check and the side-effect import branch.
- **Delta Finding 4 (worker test with env `{}` only):** adopted. The test also injects `db`, so it doesn't need the service-role name.
- **Delta Finding 5 (adapter is a thin bind; env vars only via compose):** adopted. Verified by grep in step 11.
- **Delta Finding 6 / UI Risk "percent > 100":** adopted. Clamp in core `aiBudgetMeter`; the raw percent is shown in text.
- **Delta Open question 1 (Option A vs B):** a hybrid. `readAiBudget` dynamically imports `server/ai.ts`. This keeps the real `AiClient` path (A) and catches module or construction failures (B's safety). Ming may override.
- **Delta Open question 3 (CI image as stand-in):** adopted. The local standalone probe is required; CI's image probe is authoritative (see "Runtime verification").
- **Delta "aiBudgetMeter … native `<meter>`":** helper adopted. Its shape is narrowed to `{ fillPercent, warnPercent, monthLabel }`, because the meter runs on a 0–100 percent scale, so no micro-USD `high` value is needed. A `div role="meter"` replaces native `<meter>`, which can't be styled consistently and has no tick mark (UI consult rec 7).
- **Delta: the single `AI_TIMEOUT_MS` passed to `buildProviders` and `AiClient`:** adopted (carry-over).
- **Delta bundle-check needles:** adopted, plus the SDK package names. `--scan-only` added so the failure path is testable.
- **UI delta recs 1, 3, 5, 6, 7, 8:** adopted (discriminated read, VN month label from core, duplicate `cardClass`, card above the form, meter a11y, fixtures).
- **UI delta rec 2 (`warnPercent` helper):** adopted inside `aiBudgetMeter`.
- **UI delta rec 4 / Open question 2 ("provider not configured" line):** not in this ticket. Follow-up.
- **UI delta Open question 3 / STK-070 Q5 (amber/red scheme):** STK-070 table used as the default; Ming to confirm (Assumptions).
- **STK-070 architect J copy note (refusal possible while the card shows "warn"):** rejected for v1. The extra muted line is not required by the AC. Follow-up if Ming wants it.

## Assumptions
- **Colours** follow the STK-070 UI consult table: ok `bg-accent`, warn `bg-warn`/`text-warn`, exhausted `bg-price-down`/`text-price-down`. Ming to confirm. The figma-make brief has no AI card.
- **Card placement** is above the settings form.
- **The month label** uses `nowInstant()` from the page, while `budgetStatus` uses the client's own clock. They can differ only within the same request at a month boundary, which is negligible.
- **`AI_TIMEOUT_MS = 60_000`** (the `AiClient` default) in both web and worker. STK-064+ may tune it per job.
- **Log events** `ai_budget_read_failed` with a `code` field only (no message) are acceptable observability for now.
- **`pnpm add` works offline/prefer-offline.** Both SDK versions are already in the store via `packages/ai`. If they are not, the agent proxy is used.
- **Runtime verification:** the local standalone probe and the CI image probe together satisfy "verified by running the built server or image", given that Docker is unavailable in this sandbox.

## Blocking questions
None.

## Split proposal
None. The estimate is about 450–650 changed lines including tests (architect delta), with one feature: wiring plus a read-only card. `pnpm-lock.yaml` churn is excluded from the count.

**Follow-ups to record** (not in this diff):
- Worker-image SDK resolution probe in `check-image.sh` (worker branch), together with the first AI job (STK-064).
- A "Nhà cung cấp AI chưa được cấu hình" line on the card (needs an `aiProvidersConfigured()` from `server/ai.ts`).
- A muted note that a call can be refused while the card shows "warn" (open reservations at their worst case).
- Already on the ticket: the stale `reserved` row sweep, and re-verifying model IDs and prices before go-live.
