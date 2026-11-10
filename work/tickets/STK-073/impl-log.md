## Attempt 1 — 2026-11-10

### Files touched
| File | Required because |
|---|---|
| apps/web/Dockerfile, apps/worker/Dockerfile | COPY `packages/ai/package.json` in the deps stage (AC3, frozen-lockfile in image) |
| apps/web/package.json, apps/worker/package.json, pnpm-lock.yaml | `@stoktok/ai` workspace dep and exact `@anthropic-ai/sdk 1.7.0` / `@google/genai 3.0.0` (AC2, AC3, AC6) |
| apps/worker/tsup.config.ts | `@stoktok/ai` in `noExternal` (ships .ts) |
| packages/db/src/repos/ai-usage.ts, index.ts | `aiUsageLedger(db)` and its export (AC1) |
| packages/db/src/repos/ai-usage.test.ts | aiUsageLedger tests (AC1) |
| packages/db/src/r3-guard.test.ts | server/ai.ts first-line + `./db` check, side-effect import branch, regex test (AC2) |
| apps/web/server/ai.ts, ai.test.ts | lazy AiClient wiring (AC2) |
| apps/web/server/ai-budget.ts, ai-budget.test.ts | soft-fail read for the card (AC5) |
| apps/worker/src/ai.ts, ai.test.ts | worker factory, no job (AC2) |
| apps/web/next.config.ts | transpilePackages + serverExternalPackages (AC3) |
| packages/ai/src/adapters/sdk-pins.test.ts | identical exact SDK pins across ai/web/worker (AC3) |
| scripts/check-no-service-key-in-client.sh | AI sentinels, needles, `--scan-only` (AC4) |
| scripts/check-image.sh | CI image SDK import probe (AC3) |
| packages/core/src/ai/budget.ts, budget.test.ts, index.ts | `aiBudgetMeter` (AC5, R1, R5) |
| apps/web/components/settings/ai-usage-card.tsx, .test.tsx | the card (AC5) |
| apps/web/app/(app)/settings/page.tsx | render card above the form (AC5) |

### Tests added / changed
- packages/db/src/repos/ai-usage.test.ts › aiUsageLedger › binds reserve, settle and monthSpend to db; reserve passes a 22023 DataError through with pgCode intact; monthSpend errors propagate (no zero)
- packages/db/src/r3-guard.test.ts › SDK regex catches from, import(), require() and side-effect import; apps/web/server/ai.ts exists, starts with import 'server-only' and imports from './db'
- apps/web/server/ai.test.ts › importing the module does not call getDb...; getAiBudgetStatus with no AI keys...; getAi returns the same instance
- apps/web/server/ai-budget.test.ts › ok; load failure; read failure (code-only log)
- apps/worker/src/ai.test.ts › createWorkerAi with env {} ...
- packages/ai/src/adapters/sdk-pins.test.ts › web, worker and ai package.json pin identical exact SDK versions
- packages/core/src/ai/budget.test.ts › aiBudgetMeter (fill/clamp, warnPercent from config, VN month edge)
- apps/web/components/settings/ai-usage-card.test.tsx › ok at 0, ok at 3_999_999, warn, exhausted, over cap, error state
- Not added: the vi-VN `formatUsdMicro` check; `messages-vi.test.ts` already covers it (4_000_000 -> "4,00 USD").
- Test-design note: the existing r3-guard test allows only `server/db.ts` to import `@stoktok/db` in apps/web, so `ai.test.ts` mocks `./db` with a stub ledger and `ai-budget.test.ts` uses a plain Error with `pgCode` instead of importing `DataError`.

### Checks (actual output summary)
- typecheck: all 6 projects Done, no errors.
- lint: all Done, no errors or warnings.
- test: core 779 passed; sources 35 passed; ai 169 passed; db 174 passed + 1 todo; worker 293 passed (1 file skipped); web 314 passed. No failures.
- `pnpm install --frozen-lockfile`: "Lockfile is up to date", Done.
- `pnpm check:service-key` (full build with sentinels):
```
hits for 'sb-service-SENTINEL-1104014043' in .next/static: 0
hits for 'sk-ant-SENTINEL-692610631' in .next/static: 0
hits for 'goog-SENTINEL-45591729' in .next/static: 0
hits for 'SUPABASE_SERVICE_ROLE_KEY' in .next/static: 0
hits for 'service_role' in .next/static: 0
hits for 'ANTHROPIC_API_KEY' in .next/static: 0
hits for 'GOOGLE_AI_API_KEY' in .next/static: 0
hits for '@anthropic-ai/sdk' in .next/static: 0
hits for '@google/genai' in .next/static: 0
hits for 'api.anthropic.com' in .next/static: 0
hits for 'generativelanguage.googleapis.com' in .next/static: 0
OK: no secret or AI SDK material in client bundle
```
  (11 needles: 3 sentinels + 8 fixed names; the plan said 9.)
- `--scan-only` negative cases (a file containing exactly the needle): `api.anthropic.com` -> "FAIL: secret or AI SDK material found in client bundle", exit 1; `ANTHROPIC_API_KEY` -> same, exit 1; `@google/genai` -> same, exit 1. A clean dir -> "OK: ...", exit 0.
- Standalone import probe (`pnpm --filter @stoktok/web build`, then from `apps/web/.next/standalone/apps/web`):
```
ok
exit=0
```
- Server-bundle grep with the plan's exact pattern (`require\("@anthropic-ai/sdk"\)|...`) over `apps/web/.next/server` printed **nothing**. Reason: Turbopack externalises with a hashed alias, so the plain package name never appears as a `require`. The SDKs are external (not inlined); the evidence is:
```
$ grep -rhoE "a\.y\(\"[^\"]*\"\)" apps/web/.next/server --include=*.js | sort -u
a.y("@anthropic-ai/sdk-1255717e6d35d28d")
a.y("@google/genai-67caea3a265f1561")
$ ls -l apps/web/.next/standalone/apps/web/.next/node_modules/@anthropic-ai/ .../@google/
sdk-1255717e6d35d28d -> ../../../../../node_modules/.pnpm/@anthropic-ai+sdk@1.7.0_zod@4.6.7/node_modules/@anthropic-ai/sdk
genai-67caea3a265f1561 -> ../../../../../node_modules/.pnpm/@google+genai@3.0.0/node_modules/@google/genai
```
  Importing the hashed aliases from `standalone/apps/web` printed `hashed anthropic ok function` and `hashed google ok function`. The standalone server on dummy `SUPABASE_*` env returned `/healthz` 200 with 0 `MODULE_NOT_FOUND` lines. (The one server chunk mentioning `api.anthropic.com` is our own adapter code with the fixed base URL, not SDK code.) (Superseded in Attempt 2: the plain-name probe proved nothing. It passed locally only because Node climbed out of `.next/standalone` into the repo's `node_modules`, and it fails in an isolated copy.)
- Env carry-over: `grep -nE 'ANTHROPIC_CUSTOM_HEADERS|GOOGLE_GENAI_API_VERSION' deploy/deployment-repo/apps/stoktok/compose.yml deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` printed nothing (exit 1).

### Out-of-plan files
None.

### Follow-ups (noticed, not done)
- The plan's server-bundle grep pattern does not match Turbopack's hashed externals; update the verification text (use `a\.y\("@(anthropic-ai/sdk|google/genai)-`).
- Worker-image SDK resolution probe (with STK-064).
- "Nhà cung cấp AI chưa được cấu hình" line on the card.
- Muted note that a call can be refused while the card shows "warn".
- The image probe in `check-image.sh` runs only in CI (Docker unavailable here); state this in the PR description.

### Scope self-check
- Could the diff be smaller? No.
- Diff size: see `git diff --shortstat` (lockfile +18; new files untracked). (Stale in Attempt 1: the work was committed as eed5977.)

## Attempt 2 — 2026-11-10 (REWORK)

### Files touched
| File | Required because |
|---|---|
| scripts/check-image.sh | Review Issue 1: probe now imports the Turbopack hashed aliases the server uses, from `/app/apps/web/.next/server/chunks/ssr`. It discovers alias names by prefix (`sdk-`, `genai-`) in `.next/node_modules`, exits 2 if not exactly one match, so no hash is hard-coded. |
| scripts/check-no-service-key-in-client.sh | Review nit: `--scan-only` without a dir prints a plain usage line, exit 2. |
| work/tickets/STK-073/impl-log.md | Corrected the Attempt 1 claim that the plain-name probe proves anything, and the stale "nothing committed" text. |

### Verification on a copy outside the repo
Copy of `apps/web/.next/standalone` (+ `.next/static`) at `/tmp/claude-0/-home-user-stoktok/47951d1f-9fbc-5953-bf55-b5f44f766a41/scratchpad/iso`, so resolution cannot reach the repo's `node_modules`. The command text was extracted from `scripts/check-image.sh` and run with cwd `iso/apps/web/.next/server/chunks/ssr`:
```
PASS-case
exit=0
$ ls iso/apps/web/.next/node_modules/@google
genai-67caea3a265f1561
$ rm iso/apps/web/.next/node_modules/@google/genai-*
FAIL-case
exit=2
```
Exit 2 is the "alias not found" branch, so the probe fails when an alias symlink is missing. `bash -n scripts/check-image.sh`: syntax ok. `--scan-only` with no dir: "usage: check-no-service-key-in-client.sh --scan-only <dir>", exit 2. Docker is unavailable here, so the container run happens only in CI.

### Checks
- typecheck: all Done. lint: all Done.
- test: core 779, sources 35, ai 169, db 174 + 1 todo, worker 293, web 314. No failures.
- `pnpm check:service-key`: exit 0, "OK: no secret or AI SDK material in client bundle".

### Out-of-plan files
None (both scripts were already in the plan's file list from Attempt 1).

### Follow-ups
Unchanged from Attempt 1.

### Scope self-check
Only the listed review issues were fixed. Not committed.
