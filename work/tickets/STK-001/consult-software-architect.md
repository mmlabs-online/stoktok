# consult-software-architect — STK-001

## Findings
- The repo has docs, `.claude/` and `work/` only. There is no `package.json` and no `pnpm-workspace.yaml` yet.
- `.gitignore` already ignores `.env`, `.env.local`, `.env.*.local`, `.next/`, `dist/`, `*.tsbuildinfo` and `.turbo/`. The patterns have no leading slash, so they match in any directory. `.env.example` is not ignored. No change is needed for that AC.
- The main structural decision is **how `apps/*` consume `@stoktok/core`**. The rest follows from it.
  - **Option A (recommended): "internal package" with source exports.** In core's `package.json`, `exports` points at `./src/index.ts`. Web uses `transpilePackages: ['@stoktok/core']`. The worker is bundled with tsup/esbuild (`noExternal: ['@stoktok/core']`) and run in dev with `tsx`.
    - Gains: no build-order coupling, `tsc --noEmit` works on a fresh clone, Vitest reads the TS directly, and you can jump straight to core source in the editor.
    - Gives up: core never becomes a standalone published artifact. That's fine for a private monorepo.
  - **Option B: core compiled to `dist`** with `tsc` (exports + `types` → `dist`).
    - Gains: plain `node` can import it.
    - Costs: `typecheck` and `test` in the apps need core built first. That means `pnpm -r` topological ordering or TS project references, plus stale-dist problems.
    - Only worth it if core must be published. It doesn't.
  - Note: Node 22's type stripping does **not** work on `.ts` files inside `node_modules` (workspace symlinks count), so Option A needs the worker bundled for production. tsup handles that.
- Spec §9 Q1 (how Authen's JWT is trusted: shared secret vs JWKS/server-side checks) is still open. That affects which Authen env keys exist.

## Recommendations
1. **Workspace basics (AC1, AC3)**
   - `pnpm-workspace.yaml` with `apps/*` and `packages/*`.
   - Root `package.json`: `"private": true`, `"packageManager": "pnpm@10.x.y"`, `"engines": {"node": ">=22"}`, and add `.node-version` = `22`.
   - `"type": "module"` in every package.
   - Name packages `@stoktok/web`, `@stoktok/worker`, `@stoktok/core`. Apps depend on `"@stoktok/core": "workspace:*"`.
2. **Root scripts (AC3)**
   - `typecheck`, `lint`, `test` and `build` each run `pnpm -r --if-present <script>`.
   - No Turborepo/Nx; it isn't justified yet.
   - Only core gets a `test` script for now, so empty packages don't fail and need no `--passWithNoTests`.
3. **pnpm 10 build scripts (AC3)**
   - pnpm 10 blocks dependency lifecycle scripts by default.
   - Add `onlyBuiltDependencies: [esbuild, sharp]` (in `pnpm-workspace.yaml` or root `package.json` `pnpm` field) so tsup/Next don't warn or break.
   - Commit `pnpm-lock.yaml`.
4. **TypeScript (AC3, supports R2 later)**
   - Root `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `module: ESNext` / `moduleResolution: Bundler`, `target: ES2022`, `isolatedModules`, `verbatimModuleSyntax`, `skipLibCheck`.
   - Each package extends the base and has `typecheck: tsc --noEmit`.
   - **Core tsconfig:** `lib: ["ES2022"]` and `types: []` (no DOM, no `@types/node`). This is a cheap compile-time guard that keeps core pure and framework-free (R1, dependency direction).
5. **apps/web (AC1, AC2)**
   - Hand-write the minimum instead of running `create-next-app`, which brings git init, extra files and a lockfile (R7). That means `package.json`, `next.config.ts`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx`.
   - `page.tsx` should be a **Server Component** that calls the core function. No `"use client"`, matching R1/R3 from day one.
   - Scripts: `dev`, `build: next build`, `start`, `typecheck`, `lint`.
   - Fresh clones fail `tsc` without `next-env.d.ts`. Either use `typecheck: "next typegen && tsc --noEmit"` (Next ≥15.5) or commit `next-env.d.ts`.
   - Leave out Tailwind and `output: 'standalone'`. Those belong to the UI and Docker tickets.
6. **apps/worker (AC1, AC2)**
   - `src/index.ts` imports the core function, logs one line and exits. No scheduler and no env reads.
   - Scripts: `dev: tsx watch src/index.ts`, `build: tsup src/index.ts --format esm` (core bundled), `start: node dist/index.js`, `typecheck`, `lint`.
7. **packages/core (AC2, AC4)**
   - No runtime dependencies, and `"sideEffects": false`.
   - Keep the trivial export non-financial (e.g. `export const CORE_PACKAGE = '@stoktok/core'` or `describeCore(): string`). Don't write a placeholder money function with floats that STK-002 would inherit (R2).
   - Add a `vitest.config.ts` and one test in `src/*.test.ts`.
   - No root Vitest `projects` config yet; add it when a second package gets tests.
8. **Lint (AC3)**
   - ESLint 9 flat config with typescript-eslint.
   - Next 16 removed `next lint`, so call `eslint .` directly and use `eslint-config-next`'s flat export, scoped to `apps/web`.
   - Use one shared root `eslint.config.mjs`; each package's `lint` script runs `eslint .`.
9. **Env (AC5, R3)**
   - Next only loads `.env*` from its own directory (`apps/web`), not the repo root, so "one root `.env.example`" doesn't work for dev on its own.
   - **Recommended:** a root `.env.example` (the documented single source, per the AC), plus a note telling devs to copy it to `apps/web/.env.local` and `apps/worker/.env.local`. The worker loads it via `node --env-file-if-exists=.env.local` / `tsx --env-file`.
   - Alternative: per-app `.env.example` files, which give each service least privilege (e.g. the worker doesn't need Authen keys). Planner picks; either satisfies the AC if stated.
   - Suggested keys, all empty:
     - `AUTHEN_SUPABASE_URL`, `AUTHEN_JWT_SECRET` (or `AUTHEN_JWKS_URL` — pending §9 Q1; mark it with a comment)
     - `ALLOWLIST_EMAILS`
     - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
     - `LLM_PROVIDER`, `LLM_API_KEY`
   - **No `NEXT_PUBLIC_` prefix on anything.** The browser never talks to the DB (R3), so not even the anon key is public.
10. **AC6 / R7:** no Dockerfile, CI, Supabase client, auth middleware or `supabase/` contents. If the ticket expects a `supabase/` directory, an empty `supabase/.gitkeep` is the most that's justified.

## Risks
- **Version drift (Next 15 vs 16, ESLint flat config, Vitest 3/4, typegen command):** the implementer should check the versions actually installed and adjust script syntax. Pin exact versions in the lockfile.
- **pnpm 10 ignoring build scripts:** without `onlyBuiltDependencies` you get silent warnings, and possibly a missing esbuild/sharp binary under `next build` or tsup.
- **`next-env.d.ts` on a fresh clone:** `typecheck` passes locally but fails in CI unless point 5 is handled.
- **Option A in Docker later:** the worker image must contain the bundled `dist` (core inlined). The web image needs `transpilePackages` and, later, `outputFileTracingRoot` set to the repo root. Note this for the Docker ticket.
- **Env key names are guesses** until §9 Q1 is answered. Treat `.env.example` as provisional and expect STK-auth to rename keys.

## Open questions (for Ming / planner)
1. Should env files be a single root `.env.example` or per-app? It affects dev loading (point 9).
2. Should `.env.example` include the Authen JWT trust key now, or leave a commented placeholder until §9 Q1 is decided?
3. Is the LLM provider decided (§9 Q6)? If not, keep the generic `LLM_PROVIDER` / `LLM_API_KEY`.

## Follow-ups (not for this diff)
- An ESLint `no-restricted-imports` rule: core must not import `next`, `@supabase/*` or `apps/*`, and web client components must not import the server-only env module.
- A `server-only` package plus a typed env schema per app for R3/R6, in the auth ticket.
- `output: 'standalone'` and `outputFileTracingRoot`, in the Docker ticket.
