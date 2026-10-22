## Attempt 1 — 2026-10-22
Verdict: PASS

### Checks (run by reviewer)
- install: `pnpm install --frozen-lockfile` passed (pnpm 10.28.0). Warning: the `unrs-resolver` build script was ignored. This is harmless because lint passes without it.
- typecheck: passed in core, web (`next typegen && tsc --noEmit`) and worker. Also passed on a fresh-clone condition, after `rm -rf apps/web/.next apps/worker/dist`.
- lint: `eslint .` passed in core, web and worker. `eslint --print-config apps/web/app/page.tsx` shows 23 `@next/next` rule entries, so the Next rules are applied to web.
- test: Vitest 5.0.5, 1 file / 1 test passed, 0 failed.
- build: worker (tsup → `dist/index.js`) and web (Next 16.4.2, `/` prerendered static) both passed. `node apps/worker/dist/index.js` printed `worker scaffold ready: @stoktok/core`.
- Working tree is clean after the build (the `next-env.d.ts` file was not rewritten). These results match the impl-log claims.

### Acceptance criteria
- [x] pnpm workspace with web (Next App Router TS), worker (Node TS, no jobs) and core (TS library). Evidence:
  - `pnpm-workspace.yaml:1-3` lists `apps/*` and `packages/*`.
  - `pnpm -r ls --depth -1` lists `@stoktok/web`, `@stoktok/worker` and `@stoktok/core`.
  - `apps/web/app/{layout,page}.tsx` exist, and there is no `pages/` directory.
  - `apps/worker/src/index.ts` is a 3-line log with no timers or env reads.
- [x] Web and worker both import `describeCore` from `@stoktok/core`. Evidence:
  - The import is at `apps/web/app/page.tsx:1` and `apps/worker/src/index.ts:1`.
  - Both app `package.json` files declare `workspace:*`.
  - The worker run prints `@stoktok/core`.
  - `apps/web/.next/server/app/index.html` contains `@stoktok/core`.
- [x] Root `typecheck`/`lint`/`test`/`build` run across packages and pass. Evidence: the reviewer's runs above all exited 0. `package.json:9-14` uses `pnpm -r --if-present`.
- [x] Vitest is configured and at least one core test passes. Evidence: `packages/core/vitest.config.ts`, plus `packages/core/src/index.test.ts` › `describeCore › returns the core package name` passed.
- [x] `.env.example` lists the expected keys with empty values, and `.env.local` is git-ignored. Evidence:
  - All 8 planned keys are present.
  - The grep for non-empty values prints nothing.
  - There are no `NEXT_PUBLIC_` keys.
  - `git check-ignore` matches all 3 `.env.local` paths and does not match `.env.example`.
- [x] No Dockerfiles, CI, auth or DB code. Evidence:
  - The diff has no Docker files, no `.github/` and no middleware/proxy.
  - The only file under `supabase/` is `.gitkeep`.
  - No package depends on `@supabase/*`, `jose` or `jsonwebtoken`.

### Issues
None.

### Scope
- Every changed file is either in the plan or justified.
- `apps/web/next-env.d.ts` is out of plan, but it is justified in impl-log: Next generates it and it is not ignored. Committing it keeps the tree clean. Acceptable.
- `apps/worker/tsconfig.json` includes `tsup.config.ts` as well as `src`. This is a minor deviation from the plan, but it is harmless and lets the config file be typechecked.

### Rules R1–R10
No violations found.
- R1/R2: core has a non-financial export only, and its lib is `ES2022` with `types: []`.
- R3: there are no `NEXT_PUBLIC_` keys, and the page is a Server Component.
- R7: scope is as described above.
- R8: all checks pass, and core has a test.

### Nits (do not block)
- The `globals` devDependency in root `package.json:19` is unused. The implementer already logged this.
- `apps/web/next-env.d.ts` imports `./.next/types/*.d.ts`. That works only because `typecheck` runs `next typegen` first. Keep that ordering if the scripts change.

### Follow-ups (out of scope)
- Decide whether to drop `globals` or use it.
- Consider git-ignoring `next-env.d.ts`.
- Unpin TypeScript `^6` once typescript-eslint supports TS 7.
- Carry over the architect follow-ups: `no-restricted-imports` boundaries, `server-only` plus a typed env schema, and `output: 'standalone'` for the Docker ticket.
