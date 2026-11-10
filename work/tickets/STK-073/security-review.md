# STK-073 security review

## STK-073 security review, attempt 1

**Verdict: no 🔴 and no 🟡 findings. Nothing blocks PASS.** Only Read and Grep were available to me, so I could not run `git diff`, the builds or the scripts. I reviewed the files at HEAD against plan.md, and the runtime evidence comes from impl-log.md.

### Findings

**R3: the SDKs and keys stay out of the client bundle.** 🟢 all clear
- `/home/user/stoktok/apps/web/server/ai.ts:1` starts with `import 'server-only';`.
  - The client is built lazily (lines 12–19) and nothing runs at module load.
  - It gets the service-role db only through `./db` (`getDb()`), and names no key variables.
- `/home/user/stoktok/apps/web/server/ai-budget.ts:1` is also `server-only`. It loads `./ai` with a dynamic import.
- `/home/user/stoktok/apps/web/components/settings/ai-usage-card.tsx:4` imports only a type (`import type`), which is removed at compile time. The card has no `'use client'`.
- Only `settings/page.tsx` imports `ai-budget`/`ai`, plus the tests.
- `/home/user/stoktok/packages/db/src/r3-guard.test.ts` adds these guards:
  - The SDK import regex now also catches the bare side-effect form (`import '…'`) (line 18). It already caught `from`, `import()` and `require()`, which also covers `export … from` and subpaths.
  - `server/ai.ts` must exist with `server-only` on line 1 (77–81).
  - The only `apps/web` importer of `@stoktok/ai` may be `server/ai.ts` (83–87).
  - `'use client'` files may not import `@stoktok/ai` or `server/ai*` (43–48).
  - AI key names may appear only in `packages/ai/src/env.ts` and its test (57–63).
- `/home/user/stoktok/apps/web/next.config.ts:7-8` lists `@stoktok/ai` in `transpilePackages` and both SDKs in `serverExternalPackages`.
- `/home/user/stoktok/apps/worker/src/ai.ts` is worker-only. It is not imported by `cli.ts`, so no job uses it yet.

**R6: Settings is still guarded.** 🟢
- `/home/user/stoktok/apps/web/app/(app)/settings/page.tsx:13`: `requireUser()` runs before `readAiBudget()` (line 16).
- No new route or server action is exposed.

**Error text and pgCode never reach the UI.** 🟢
- `ai-budget.ts:15-18` returns a bare `{ ok: false }`. The log line carries only `module_not_found` or `read_failed`, with no message and no pgCode.
- The card's error state (`ai-usage-card.tsx:25-32`) shows fixed text only.
- The `AiClient` warn events log codes and IDs only (`packages/ai/src/client.ts:152,171,176,195`), never error messages or keys.

**The budget card never shows a false zero.** 🟢
- `getAiMonthSpend` (`/home/user/stoktok/packages/db/src/repos/ai-usage.ts:69-73`) goes through `unwrap` and `toSafeInt`.
  - A null or non-integer value throws a `RowMappingError` instead of turning into 0.
  - `aiUsageLedger` (75–82) passes errors through unchanged.
- The card renders amounts only when `read.ok && meter`. Otherwise it shows the error line.
- `aiBudgetMeter` (`packages/core/src/ai/budget.ts:60-67`) limits the bar width to 0–100. The text still shows the real percent, even above 100.

**The bundle-check script is strict enough.** 🟢 with notes
- `/home/user/stoktok/scripts/check-no-service-key-in-client.sh` checks 11 strings in build mode:
  - 3 fake random keys (sentinels) passed into the build.
  - the 4 key and role names (`SUPABASE_SERVICE_ROLE_KEY`, `service_role`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`).
  - the 2 SDK package names and the 2 API hostnames.
- The search is exact and case-sensitive (`grep -rlF --`). A failed build or a missing directory makes the script fail (`set -euo pipefail`, line 20).
- `--scan-only` uses only the fixed strings, as planned. The impl-log records the negative tests exiting 1.
- 🟢 Line 28 prints the sentinel values into the CI log. They are random throwaway values, not secrets, so this is harmless.
- 🟢 Existing gap, not new here: only `.next/static` is scanned. Pre-rendered HTML/RSC under `.next/server/app` is also served to browsers. Settings is `force-dynamic`, so this ticket is not affected. Possible follow-up: scan `*.html` and `*.rsc` there too.

**Dockerfiles.** 🟢
- `/home/user/stoktok/apps/web/Dockerfile:13` and `/home/user/stoktok/apps/worker/Dockerfile:13` only add `COPY packages/ai/package.json`.
- `.dockerignore` excludes `.next`, `.env*` and `work`, so local build output from the sentinel run cannot get into the image.
- The runtime image still runs as `USER node`.

**`/home/user/stoktok/scripts/check-image.sh:54-56`.** 🟢
- The SDK import probe inside the container is correct: it runs in `/app/apps/web` as the `node` user and fails with `::error::`.
- Nit: the reject handler `()=>process.exit(1)` throws away the cause. Printing `e.code` would make a red CI run easier to diagnose.

**Dependency pinning.** 🟢
- `@anthropic-ai/sdk` 1.7.0 and `@google/genai` 3.0.0 are pinned exactly in the web, worker and ai `package.json` files.
- `@stoktok/ai` is `workspace:*`.
- The lockfile importers match (`pnpm-lock.yaml:30-40, 91-101, 130-135`).

**Timeouts.** 🟢
- Web and worker each set `AI_TIMEOUT_MS = 60_000` and pass it to both `buildProviders` and `AiClient`, as the carry-over asked.
- 🟢 Not new: the Supabase read behind the card (`ai_month_spend`) has no fetch timeout. A hanging database would hang Settings, but `getAppSettings` already behaves the same way.
- 🟢 Operational note: `getAi()` is a singleton, so after a key rotation the web container must be restarted to pick up the new keys. This belongs in the runbook.

### Recommendations
1. Approve on R3 and R6 (AC2, AC3, AC4). No changes are needed in this diff.
2. Optional follow-ups, outside this ticket per R7:
   - Print the error code in the `check-image.sh` SDK probe.
   - Extend the bundle check to pre-rendered `.next/server/app/**/*.{html,rsc}`.
   - Add a worker-image SDK resolution probe (already listed for STK-064).
   - Add a note to the deploy runbook to restart the web container after rotating an AI key.

### Risks
- `@stoktok/ai` itself has no `server-only` marker, and can't have one because the worker uses it. Keeping it out of the client relies on the r3-guard regexes plus the bundle check, which catches the SDK names and hostnames at build time. That is enough today. A client file could still reach it through an intermediate non-`'use client'` module; only the bundle check would catch that.
- The image probe runs only in CI. A red `images` job on the PR means REWORK, as plan.md says.

### Open questions
None.
