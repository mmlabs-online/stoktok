## STK-073: delta to the STK-070 architect consult (items E–J)

This covers only what is new or changed now that STK-070 is on main. I read the code and did not run anything, so I could not check whether Docker works in this sandbox.

### Findings (new)
1. **Blocker for any image build: both Dockerfiles never copy `packages/ai/package.json`.** The `deps` stage in `apps/web/Dockerfile` and `apps/worker/Dockerfile` copies only the core, db and sources manifests. The SDKs and `zod` that `packages/ai` needs are therefore never installed in the image. As soon as web imports `@stoktok/ai`, `next build` inside Docker fails to resolve `zod` and the SDKs from `packages/ai/src`. `pnpm --frozen-lockfile` may also fail early, because the lockfile lists a project that isn't there. Local and CI `pnpm build` will still pass, so only the image job would catch it. Fix: add `COPY packages/ai/package.json packages/ai/` to both Dockerfiles.
2. **The worker build needs more than G said.** `apps/worker/tsup.config.ts` has `noExternal: ['@stoktok/core','@stoktok/db','@stoktok/sources']`, so `@stoktok/ai` must be added there; it ships `.ts` source and can't be loaded from `node_modules`. tsup leaves out only the worker's *own* dependencies and bundles everything else. Without direct worker dependencies, esbuild would therefore pull both SDKs into the bundle, and `@google/genai`'s Node build has optional and dynamic requires. Because `cli.ts` won't import `src/ai.ts` this ticket (no job, R7), none of this reaches `dist` yet.
3. **The r3-guard already has most of item F/I's guards.** Already present: `'use client'` files may not import `@stoktok/ai` or `server/ai`; in `apps/web` only `server/ai.ts` may import `@stoktok/ai`; the SDKs are imported only under `packages/ai/`; the AI key names appear only in `env.ts` and its test; `fakes` is used only by tests. What's missing:
   - a check that line 1 of `server/ai.ts` is `import 'server-only';`
   - a check that the file exists, so the importer test can't pass vacuously
   - the SDK regex has no `import\s+'…'` (side-effect import) branch.

   Strings inside `next.config.ts` and `package.json` won't trip the SDK regex: it needs `from`, `import(` or `require(`, and `.json` files aren't scanned anyway.
4. **The key-name guard limits the worker test.** A test that sets `ANTHROPIC_API_KEY` in `apps/worker/src/ai.test.ts` would break the guard. Test only the no-keys env (`{}`). `providers.test.ts` already covers which key turns on which provider.
5. **Several pieces are already done.** `DataError` keeps `pgCode` (`packages/db/src/errors.ts`), so item E's adapter really is a thin bind. `ReserveRequest`/`ReserveResult` match `AiReserveRequest`/`AiReserveResult` field for field. `AiClient.budgetStatus()` exists. The deploy env already writes the two keys (STK-072). The env file is written from a fixed key list, so `ANTHROPIC_CUSTOM_HEADERS` / `GOOGLE_GENAI_API_VERSION` can only arrive through compose `environment:`. Checking that with one grep and noting it is enough.
6. **Raw `percent` can go above 100** (for example if the cap is lowered in config), and `warnPpm` is in ppm. The UI must not clamp or convert either one itself (R1).

### Recommendations
- **Ticket and dependency changes.**
  - **Dockerfiles (Finding 1):** add the `packages/ai` COPY line to both Dockerfiles in this ticket. It's an AC3 prerequisite, not scope creep.
  - **Worker:** add `@stoktok/ai: workspace:*` to `apps/worker/package.json`, add `'@stoktok/ai'` to tsup `noExternal`, and add `@anthropic-ai/sdk: 1.7.0` and `@google/genai: 3.0.0` as exact-pinned direct worker dependencies. tsup then keeps the SDKs external and `pnpm deploy --prod` installs them.
  - **Web:** the same exact pins in `apps/web`. Extend `adapters/sdk-pins.test.ts` (or the guard) to assert that the web, worker and ai `package.json` pins are identical.
  - **Worker image check:** follow-up for the first AI job ticket (STK-064).
- **r3-guard additions (exact):**
  ```ts
  test("apps/web/server/ai.ts starts with import 'server-only' and uses ./db", () => {
    const text = readFileSync(join(ROOT, 'apps/web/server/ai.ts'), 'utf8');
    expect(text.startsWith("import 'server-only';")).toBe(true);
    expect(/from '\.\/db'/.test(text)).toBe(true);
  });
  ```
  - Extend the SDK regex with an `import\s+` branch, matching the `@stoktok/ai` importer regex. Add the side-effect form to the "catches" test.
  - No change to the key-name allow-list.
- **Verifying `serverExternalPackages` at runtime.**
  - Hitting `/settings` with no session doesn't prove anything: `proxy.ts` redirects to `/login` before the page module (and so the SDK `require`) loads. Neither does `/healthz`.
  - Use an explicit resolution probe from the directory the server chunks resolve from. On the standalone build, after `pnpm --filter @stoktok/web build`:
    `cd apps/web/.next/standalone/apps/web && node -e "Promise.all([import('@anthropic-ai/sdk'),import('@google/genai')]).then(()=>console.log('ok'))"`
    Also confirm `grep -rl "@anthropic-ai/sdk" apps/web/.next/server` shows a `require` (i.e. not bundled).
  - Make it permanent in `scripts/check-image.sh` (web branch):
    `docker exec -w /app/apps/web "$NAME" node -e "Promise.all([import('@anthropic-ai/sdk'),import('@google/genai')]).then(()=>process.exit(0),()=>process.exit(1))"`
    followed by `::error::` on failure. That way CI's image job enforces it even if Docker isn't available here.
  - The orchestrator should check `docker info` first. If Docker is missing (likely in this cloud sandbox), the standalone probe plus `next start`-less evidence is the local proof and CI is the authoritative run.
- **Client-bundle check (item I), unchanged except:** export both sentinels in the same `pnpm build` invocation, and add `@anthropic-ai/sdk`, `@google/genai`, `api.anthropic.com` and `generativelanguage.googleapis.com` to the needle loop. The `.sh` file isn't scanned by r3-guard, so naming the keys there is fine.
- **Settings card (item J, refined for R1/R5):** add one core helper, e.g. `aiBudgetMeter(status, cfg)`, returning integers `{ value: min(spent, cap), max: cap, high: warnMicroUsd, barPercent: min(percent, 100), warnMarkPercent: warnPpm / 10_000 }`. Render a native `<meter min=0 max value high>` plus a text label, so the UI does no arithmetic. Unit-test the helper at 79%, 80%, 100% and above 100%.
- **Timeout carry-over:** in both `server/ai.ts` and `worker/src/ai.ts`, use one `const AI_TIMEOUT_MS` passed to both `buildProviders(env, { timeoutMs })` and `new AiClient({ timeoutMs })`.
- **Size:** this fits one implement/review cycle, roughly 450–650 lines including tests. Have the planner order it: Dockerfiles/deps → ledger adapter → `server/ai.ts` + guard → worker factory → `next.config` + standalone probe → bundle-check script → core meter helper → card. Expect the security auditor at REVIEW; the Dockerfile and bundle-script parts are where it will focus.

### Risks
- **One missing module breaks all of Settings.** A static import chain from the Settings page to the SDKs means an unresolved external fails the whole page with MODULE_NOT_FOUND, not just the card, which defeats "fail soft".
  - Option A (recommended): keep static imports and rely on the image probe above.
  - Option B: `getAiBudgetStatus` uses only core and db (`budgetStatus(getAiMonthSpend(getDb(), aiBudgetWindow(now)))`), so Settings never loads the SDKs. Safer, but nothing in web would exercise the externals until STK-064, and it skips the `AiClient` path.
- **The image job is the only gate for Finding 1.** If Docker can't run here, the PR depends on CI to find a Dockerfile mistake. That costs a REWORK at worst, not a silent break.
- **`pnpm install --frozen-lockfile` will change `pnpm-lock.yaml`** for the new web and worker dependencies. The implementer must commit the lockfile, or CI fails.

### Open questions
1. Option A or B for the Settings import path (A recommended)?
2. Should this ticket also add the worker dependencies, `noExternal` and the Dockerfile COPY line (recommended: yes; they're cheap and avoid surprises in STK-064), with the worker-image runtime probe deferred to STK-064?
3. Is the CI image job an acceptable stand-in for the "verified by running the built server or image" AC if Docker isn't available here? The standalone `node -e import(...)` probe would be the local proof.

### Files
- /home/user/stoktok/apps/web/Dockerfile
- /home/user/stoktok/apps/worker/Dockerfile
- /home/user/stoktok/apps/worker/tsup.config.ts
- /home/user/stoktok/packages/db/src/r3-guard.test.ts
- /home/user/stoktok/scripts/check-image.sh
- /home/user/stoktok/scripts/check-no-service-key-in-client.sh
- /home/user/stoktok/apps/web/next.config.ts
- /home/user/stoktok/packages/core/src/ai/budget.ts
- /home/user/stoktok/apps/web/app/(app)/settings/page.tsx
