## Attempt 1 — 2026-11-10
Verdict: REWORK

### Checks (run by reviewer)
- typecheck: `pnpm typecheck` exit 0 (all projects Done).
- lint: `pnpm lint` exit 0.
- test: `pnpm test` exit 0. core 779, sources 35 (+1 skipped file), ai 169, db 174 + 1 todo, worker 293 (+1 skipped file), web 314. These match impl-log.
- `pnpm check:service-key`: exit 0. It reports 11 needles, all `hits … : 0`, and prints "OK: no secret or AI SDK material in client bundle". The run's sentinel values (`sk-ant-SENTINEL-`, `goog-SENTINEL-`, `sb-service-SENTINEL-`) also appear nowhere under `apps/web/.next`, server output included.
- `--scan-only` negative cases: a file containing `api.anthropic.com`, `ANTHROPIC_API_KEY` or `@google/genai` gives exit 1 with "FAIL: secret or AI SDK material found in client bundle". A clean dir gives exit 0. `--scan-only` with no dir gives exit 1 and a usage message.
- `pnpm install --frozen-lockfile`: not re-run (the lockfile diff is consistent with the package.json changes).
- Standalone build plus the plain-name SDK probe run from `apps/web/.next/standalone/apps/web`: prints `ok`. **It passes for the wrong reason (see Issue 1).**
- Plan's server-bundle grep (`require("@anthropic-ai/sdk")|…`): no output, which matches impl-log. Turbopack emits `a.y("@anthropic-ai/sdk-1255717e6d35d28d")` and `a.y("@google/genai-67caea3a265f1561")` in `.next/server/chunks/ssr/[root-of-the-server]__1nag52yz4oe1x._.js`. In the Turbopack runtime, `y` is `externalImport` (`await import(id)`). The hashed ids are symlinks in `.next/standalone/apps/web/.next/node_modules/{@anthropic-ai,@google}/` and point to `standalone/node_modules/.pnpm/…`. impl-log's explanation is correct: the SDKs are external, not inlined.
- Image-equivalent test (Docker is unavailable): I copied `.next/standalone` and `.next/static` to an isolated dir (the image's `/app` layout, with no repo `node_modules` above it).
  - Importing `@anthropic-ai/sdk-1255717e6d35d28d` and `@google/genai-67caea3a265f1561` from `apps/web/.next/server/chunks/ssr` gives `hashed ok function function`. The server's real path works.
  - `server.js` with dummy env serves `/healthz` 200 with 0 `MODULE_NOT_FOUND`.
  - **The plain-name probe from `apps/web` (the exact command in `scripts/check-image.sh`) fails with `ERR_MODULE_NOT_FOUND`.**
- Dockerfile (`apps/web/Dockerfile`): the runtime stage copies the whole `/repo/apps/web/.next/standalone` to `/app`. `COPY` keeps the relative symlinks, so `/app/apps/web/.next/node_modules/@anthropic-ai/sdk-<hash>` resolves to `../../../../../node_modules/.pnpm/…`, which is `/app/node_modules/.pnpm/…`, and that path is present in standalone. The added `COPY packages/ai/package.json` puts the SDK deps in the install. `.dockerignore` excludes `**/node_modules` and `**/.next` only from the context, which is fine. Standalone has no plain `@anthropic-ai`/`@google` under `apps/web/node_modules` (only `next`) or under root `node_modules` (only `.pnpm`).

### Acceptance criteria
- [x] AC1 `UsageLedger` adapter, errors pass through, 22023 test. Evidence: `packages/db/src/repos/ai-usage.ts:75-82`, and `ai-usage.test.ts › aiUsageLedger › reserve passes a 22023 DataError through with pgCode intact` (instanceof DataError, pgCode 22023). Typecheck proves the structural match in `apps/web/server/ai.ts:15`.
- [x] AC2 `server/ai.ts`: line 1 is `import 'server-only';`, it is the only `@stoktok/ai` importer, it uses `./db`, it is lazy (`??=`), and it works with no keys. Evidence: r3-guard `apps/web/server/ai.ts exists, starts with import 'server-only'…` and the importer test, `server/ai.test.ts` (3 tests), and the worker factory `apps/worker/src/ai.ts` with `ai.test.ts`. `cli.ts` and `index.ts` are untouched.
- [ ] AC3 `next.config.ts` keys and the exact pins (`sdk-pins.test.ts`) are correct. "Verified by running the built server or image" FAILED, see Issue 1. The local probe impl-log cites passes only because Node climbs out of the standalone tree into the repo's `node_modules`, and the CI image probe added in `scripts/check-image.sh` will fail.
- [x] AC4 the bundle check uses AI sentinels and fails on sentinels, key names, SDK names and hostnames. Evidence: the run and the negative cases above.
- [x] AC5 the card is above the form, read-only, with warn, exhausted and error states. All numbers come from core (`budgetStatus`, `aiBudgetMeter`, `formatUsdMicro`, `aiMessage`), and the warn mark comes from `cfg.budget.warnPpm`. It uses `role="meter"` with valuenow/valuetext, and icons plus text so colour is never the only cue. Evidence: `ai-usage-card.test.tsx` (6), `budget.test.ts › aiBudgetMeter` (3), `ai-budget.test.ts` (3), `settings/page.tsx:16-21`.
- [ ] AC6 typecheck, lint, test and the client-bundle check are green, but the CI `images` job will go red because of Issue 1. The plan says "A red CI image job on the PR becomes a REWORK".

### Issues
#### Issue 1 — 🔴 blocker — runtime verification / CI image probe
- **Where**: `scripts/check-image.sh:54-56`. Also impl-log "Standalone import probe" and "The plain-name probe in `scripts/check-image.sh` passes locally from the same directory".
- **Expected**: A probe that proves the SDKs resolve the way the built server loads them, and that passes inside the image.
- **Actual**: The probe runs `import('@anthropic-ai/sdk')` and `import('@google/genai')` with cwd `/app/apps/web`. In the image, neither `/app/apps/web/node_modules` nor `/app/node_modules` has those plain names (standalone ships only the hashed aliases in `apps/web/.next/node_modules` plus `.pnpm`). Locally it prints `ok` only because resolution climbs out of `.next/standalone` into `/home/user/stoktok/node_modules/.pnpm/…`: `require.resolve` from that dir returns the repo path. An isolated copy of standalone reproduces the failure (`ERR_MODULE_NOT_FOUND`), so CI's `images` job will fail.
- **Fix instruction**: Replace the probe in `scripts/check-image.sh` with one that imports the hashed aliases the server actually uses, run from `.next/server`. I verified this command passes on an isolated standalone copy:
  ```bash
  if ! docker exec -w /app/apps/web/.next/server "$NAME" node -e "const fs=require('fs');const d='../node_modules';const ids=[['@anthropic-ai','sdk-'],['@google','genai-']].map(([s,p])=>{const n=fs.readdirSync(d+'/'+s).filter(x=>x.startsWith(p));if(n.length!==1)process.exit(2);return s+'/'+n[0]});Promise.all(ids.map(i=>import(i))).then(()=>process.exit(0),()=>process.exit(1))"; then
    echo "::error::web smoke failed: AI SDK externals do not resolve in the image"; exit 1
  fi
  ```
  Then re-verify locally on a **copy of `.next/standalone` outside the repo**, so resolution cannot reach the repo's `node_modules`. Run the same command from `<copy>/apps/web/.next/server`, and paste the output into impl-log. Correct the impl-log statement that the plain-name probe proves anything.

### Rules R1–R10
- No violations found.
  - R1/R2/R5: the card does no arithmetic. The meter geometry is in core, and the warn mark comes from config.
  - R3: `server-only` on `ai.ts` and `ai-budget.ts`, the client-bundle check is green, and the SDKs are external.
  - R6: the Settings page calls `requireUser()` before `readAiBudget()`.
  - R7: every changed file is in the plan.
  - R8: core and db tests were added.

### Nits (do not block)
- impl-log "Scope self-check" says "Nothing committed, per the orchestrator", but the work is committed (`eed5977`). It is stale text.
- `check-no-service-key-in-client.sh --scan-only` without a dir prints bash's `${2:?}` message ("line 11: 2: usage…"). It works, but a plain `echo usage >&2; exit 2` would read better.

### Follow-ups (out of scope)
- Fix the plan template's server-bundle grep for Turbopack, e.g. `a\.y\("@(anthropic-ai/sdk|google/genai)-[0-9a-f]+"\)`. Also make standalone probes always run from a copy outside the repo, so Node cannot resolve modules from the repo's `node_modules`.
- Worker-image SDK resolution probe (with STK-064). "Provider not configured" line on the card. Muted "may be refused while warn" note. Stale `reserved` row sweep. Re-verify model IDs and prices before go-live.
