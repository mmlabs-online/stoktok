Status: READY

# Plan — STK-001: Scaffold pnpm workspace and tooling

## Spec summary
- docs/spec-v1.md §4.1 Services:
  > | `web` | Next.js UI and API routes; reads/writes app DB; verifies Authen JWT + allowlist |
  > | `worker` | Scheduled jobs: price polling, EOD sync, financials, news fetch, signal computation, AI summaries, suggestion scoring |
- docs/spec-v1.md §7 Deployment:
  > Secrets (Supabase keys, LLM API key) only in the deploy repo's env handling, never in the app repo.
- docs/spec-v1.md §4.2: "Allowlist check (Ming's user ID) on every request". This is the basis for the allowlist env key name.
- CLAUDE.md Stack: "Next.js (App Router, TypeScript) in `apps/web`", "Node.js + TypeScript in `apps/worker`", "`packages/core` (TypeScript)", "pnpm workspaces", "Vitest (unit)", and "The workspace (`apps/`, `packages/`, `supabase/`) is created by ticket STK-001. Standard scripts once scaffolded: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`."

This ticket only builds the skeleton. None of the runtime responsibilities above (auth, DB, jobs) are in scope. See AC6.

## Acceptance criteria → verification
| # | Criterion | How the reviewer verifies it |
|---|---|---|
| 1 | pnpm workspace with `apps/web` (Next.js, App Router, TypeScript), `apps/worker` (Node + TypeScript, no jobs yet), `packages/core` (TypeScript library). | `pnpm-workspace.yaml` lists `apps/*` and `packages/*`. `pnpm -r ls --depth -1` shows `@stoktok/web`, `@stoktok/worker` and `@stoktok/core`. `apps/web/app/layout.tsx` and `apps/web/app/page.tsx` exist (App Router). There is no `pages/` dir. `apps/worker/src/index.ts` has no scheduler, timers or env reads. |
| 2 | `apps/web` and `apps/worker` both import a trivial exported function from `packages/core`, proving the workspace link. | `apps/web/app/page.tsx` and `apps/worker/src/index.ts` both contain `import { describeCore } from '@stoktok/core'`. Both app `package.json` files have `"@stoktok/core": "workspace:*"`. After `pnpm build`, `node apps/worker/dist/index.js` prints a line containing `@stoktok/core`. `next build` completes and the page is prerendered with the core string (check `apps/web/.next/server/app/index.html` contains `@stoktok/core`). |
| 3 | Root scripts `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` run across all packages and pass. | From the repo root after `pnpm install --frozen-lockfile`, run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. All exit 0. Output shows typecheck/lint running in all 3 packages and build running in web and worker. Also run `pnpm typecheck` with no `apps/web/.next` directory (fresh-clone condition): it must pass. |
| 4 | Vitest configured with at least one passing test in `packages/core`. | `pnpm test` runs `packages/core/src/index.test.ts` and reports 1+ passed, 0 failed. |
| 5 | `.env.example` lists the expected keys with empty values (Authen, app Supabase URL/anon/service role, LLM key); `.env.local` is git-ignored. | `.env.example` contains `AUTHEN_SUPABASE_URL`, `AUTHEN_JWT_SECRET`, `ALLOWLIST_USER_IDS`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `LLM_PROVIDER` and `LLM_API_KEY`. `grep -Ev '^\s*(#\|$)' .env.example \| grep -v '=$'` prints nothing (all values empty). `grep NEXT_PUBLIC_ .env.example` prints nothing (R3). `git check-ignore .env.local apps/web/.env.local apps/worker/.env.local` prints all three paths. `git check-ignore .env.example` prints nothing. |
| 6 | No Dockerfiles, CI, auth, or DB code yet (separate tickets). | `git diff --name-only main...HEAD` shows no `Dockerfile*`, no `docker-compose*`, no `.github/`, no files under `supabase/` other than `supabase/.gitkeep`, no middleware, and no `@supabase/*` or JWT libraries in any `package.json`. |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `package.json` | create | Root: `"private": true`, `"type": "module"`, `"packageManager": "pnpm@<installed 10.x>"`, `"engines": {"node": ">=22"}`. Scripts `typecheck`/`lint`/`test`/`build` each run `pnpm -r --if-present <script>`. Shared devDeps: `typescript`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-next`, `globals` (AC3). |
| `pnpm-workspace.yaml` | create | `packages: [apps/*, packages/*]` plus `onlyBuiltDependencies: [esbuild, sharp]` for pnpm 10 (AC1, AC3). |
| `pnpm-lock.yaml` | create (generated) | Reproducible install (`--frozen-lockfile`). |
| `.node-version` | create | `22`. Pins the runtime. |
| `tsconfig.base.json` | create | Shared strict TS settings (AC3, supports R2 later). |
| `eslint.config.mjs` | create | Single ESLint 9 flat config: typescript-eslint recommended everywhere, plus `eslint-config-next` scoped to `apps/web/**`. Ignores `**/.next/**`, `**/dist/**`, `**/next-env.d.ts` (AC3). |
| `.env.example` | create | Documented env keys, all empty, with comments (AC5). |
| `supabase/.gitkeep` | create | CLAUDE.md says STK-001 creates `supabase/`. The directory stays empty (AC6). |
| `packages/core/package.json` | create | `@stoktok/core`, `"type": "module"`, `"sideEffects": false`, `exports` → `./src/index.ts`, no runtime deps. Scripts `typecheck`, `lint`, `test` (`vitest run`). devDep `vitest` (AC1, AC4). |
| `packages/core/tsconfig.json` | create | Extends base. `lib: ["ES2022"]`, `types: []` (no DOM/Node: keeps core pure, R1). `include: ["src"]`. |
| `packages/core/vitest.config.ts` | create | Vitest config (`include: ['src/**/*.test.ts']`, environment `node`) (AC4). |
| `packages/core/src/index.ts` | create | `export function describeCore(): string` returns `'@stoktok/core'` (AC2). |
| `packages/core/src/index.test.ts` | create | First unit test (AC4). |
| `apps/web/package.json` | create | `@stoktok/web`. Deps `next`, `react`, `react-dom`, `@stoktok/core: workspace:*`. devDeps `@types/react`, `@types/react-dom`, `@types/node`. Scripts `dev`, `build: next build`, `start: next start`, `typecheck`, `lint: eslint .` (AC1–3). |
| `apps/web/next.config.ts` | create | `transpilePackages: ['@stoktok/core']` only (AC2). |
| `apps/web/tsconfig.json` | create | Extends base. Adds `jsx: preserve`, DOM libs, the Next plugin, `include` of `next-env.d.ts`, `**/*.ts`, `**/*.tsx` and `.next/types/**/*.ts` (AC3). |
| `apps/web/app/layout.tsx` | create | Minimal root layout, `<html lang="vi">` (AC1). |
| `apps/web/app/page.tsx` | create | Server Component (no `"use client"`). Renders `describeCore()` output (AC2). |
| `apps/web/next-env.d.ts` | create **only if** `next typegen` is unavailable (see Approach step 5) | Fresh-clone typecheck (AC3). |
| `apps/worker/package.json` | create | `@stoktok/worker`. Dep `@stoktok/core: workspace:*`. devDeps `tsup`, `tsx`, `@types/node`. Scripts `dev: tsx watch src/index.ts`, `build: tsup`, `start: node dist/index.js`, `typecheck`, `lint` (AC1–3). |
| `apps/worker/tsconfig.json` | create | Extends base, `types: ["node"]`, `include: ["src"]`. |
| `apps/worker/tsup.config.ts` | create | `entry: ['src/index.ts']`, `format: ['esm']`, `target: 'node22'`, `noExternal: ['@stoktok/core']`, `clean: true` (AC2, AC3). |
| `apps/worker/src/index.ts` | create | Imports `describeCore`, logs one line (`worker scaffold ready: <describeCore()>`), exits (AC2). |

No changes to `.gitignore`: it already covers `.env.local`, `.env.*.local`, `.next/`, `dist/`, `node_modules/`, `*.tsbuildinfo`, with no leading slashes, so the patterns match in any directory (architect finding, re-checked). No changes to README, CLAUDE.md or docs.

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `packages/core/src/index.test.ts` › `describeCore › returns the core package name` | AC4. Also confirms Vitest reads TS source directly. Asserts `describeCore() === '@stoktok/core'`. |

No financial logic in this ticket, so no domain edge-case tests apply (rule 6 n/a).

## Approach
1. **Root workspace.** Create `package.json`, `pnpm-workspace.yaml`, `.node-version` and `tsconfig.base.json`. Base options: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, `isolatedModules`, `verbatimModuleSyntax`, `skipLibCheck`, `noEmit: true`, `resolveJsonModule`, `esModuleInterop`. Set `packageManager` to the pnpm 10 version actually installed (`pnpm -v`). No Turborepo/Nx.
2. **packages/core (Option A: source exports).** `exports: { ".": "./src/index.ts" }`, `types` → `./src/index.ts`. Add the `describeCore` function and its test. `typecheck: tsc --noEmit`, `test: vitest run`, `lint: eslint .`. No `build` script: core is consumed as source. `--if-present` skips it.
3. **apps/worker.** `tsup` bundles core into `dist/index.js`. Node 22 cannot type-strip `.ts` files reached through `node_modules` symlinks, which is why core is bundled. `dev` uses `tsx`. Do not read env vars and do not add a scheduler.
4. **apps/web.** Hand-write the files. Do **not** run `create-next-app` (R7: it adds extra files, git init and a lockfile). No Tailwind, no `output: 'standalone'`, no middleware, no API routes. The page is a Server Component (R1/R3 posture).
5. **Web typecheck on a fresh clone.** Use `"typecheck": "next typegen && tsc --noEmit"` if the installed Next version supports `next typegen` (≥15.5). Otherwise commit `apps/web/next-env.d.ts` with the standard Next content and use `tsc --noEmit`. Record which one was used in impl-log.
6. **Lint.** Use one root `eslint.config.mjs`. Each package's `lint` script is `eslint .`, which resolves the root config by walking up from the cwd. Use `eslint-config-next`'s flat-config export, limited to `apps/web/**`. Do not use `next lint`. If the installed Next still ships it, prefer plain `eslint .` anyway for consistency. Use the non-type-checked typescript-eslint `recommended` preset (keeps setup simple; stricter presets are a follow-up).
7. **Env.** Create a root `.env.example` as the single documented source. Header comment: "Copy to `apps/web/.env.local` and `apps/worker/.env.local` (Next loads env from its own app dir). Never commit real values. Production secrets live in the deploy repo (spec §7). No `NEXT_PUBLIC_` keys: the browser never talks to the DB (R3)." Keys, all empty, grouped with comments:
   - Authen: `AUTHEN_SUPABASE_URL=`, `AUTHEN_JWT_SECRET=`. Add the comment "provisional, pending spec §9 Q1 (shared secret vs JWKS/server-side checks); auth ticket may rename/replace".
   - Allowlist: `ALLOWLIST_USER_IDS=`. Comment: "comma-separated Authen user IDs (spec §4.2)".
   - App DB: `SUPABASE_URL=`, `SUPABASE_ANON_KEY=`, `SUPABASE_SERVICE_ROLE_KEY=`. Comment on the service role key: "server-only (R3)".
   - LLM: `LLM_PROVIDER=`, `LLM_API_KEY=`. Comment: "provider pending spec §9 Q6".
   Nothing reads these yet.
8. **pnpm 10 build scripts.** Run `pnpm install`. If pnpm warns about other ignored build scripts (e.g. `unrs-resolver` from eslint-config-next), add only the packages whose binaries are actually needed for the four scripts to pass to `onlyBuiltDependencies`, and log them in impl-log. Commit `pnpm-lock.yaml`.
9. **Verify** (from the root): `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm build && node apps/worker/dist/index.js`. Then delete `apps/web/.next` and re-run `pnpm typecheck`.

Rules applied:
- R1: core has no DOM/Node types, and the trivial export is non-financial (no placeholder money function with floats for STK-002 to inherit, R2).
- R3: no `NEXT_PUBLIC_` keys, and the web page is a Server Component.
- R5/R6/R9/R10: nothing implemented yet.
- R7: the file list above is exhaustive.
- R8: the four checks must be green.

## Specialist input used
From `consult-software-architect.md`:
- **Adopted:**
  - Option A, core consumed as source (no build-order coupling, typecheck works on a fresh clone).
  - `pnpm -r --if-present` root scripts, no Turborepo.
  - `onlyBuiltDependencies`.
  - Strict base tsconfig, and core with `types: []` / `lib: ES2022`.
  - Hand-written Next app, Server Component page.
  - tsup bundling with `noExternal` and tsx dev for the worker.
  - The `next typegen` / `next-env.d.ts` handling.
  - One root ESLint flat config with `eslint .`.
  - No `NEXT_PUBLIC_` keys.
  - Only `supabase/.gitkeep`.
  - Non-financial trivial export.
- **Open Q1 (root vs per-app env):** resolved as a single root `.env.example` plus a copy instruction. The AC says "`.env.example`" (singular). Per-app least-privilege files can come with the auth/worker env schema follow-up.
- **Open Q2 (Authen trust key):** resolved by including `AUTHEN_JWT_SECRET` as a provisional key, with a comment pointing at §9 Q1.
- **Open Q3 (LLM provider):** resolved with the generic `LLM_PROVIDER` / `LLM_API_KEY`.
- **Adjusted:** the architect suggested `ALLOWLIST_EMAILS`. Renamed to `ALLOWLIST_USER_IDS` because spec §4.2 says "Allowlist check (Ming's user ID)".
- **Deferred to follow-ups (not in diff):**
  - `no-restricted-imports` boundary rules.
  - `server-only` plus a typed env schema.
  - `output: 'standalone'` / `outputFileTracingRoot` (Docker ticket).
  - Root Vitest `projects` config (when a second package gets tests).

## Assumptions
- Node 22 and pnpm 10 are available (as stated by the orchestrator). The implementer installs the current stable versions of Next, React, TypeScript, ESLint 9, typescript-eslint, Vitest, tsup and tsx, then adapts script syntax to those versions (e.g. the Next 15 vs 16 lint/typegen differences), recording versions in impl-log.
- Env key names are provisional and may be renamed by the auth ticket once spec §9 Q1 is answered. That does not block scaffolding, because nothing reads them yet.
- `pnpm build` building only web and worker (core has no build) satisfies "run across all packages": `--if-present` runs it wherever the script exists.
- Next may print telemetry or a "workspace root" warning during build. Warnings are acceptable if the exit code is 0. Do not add `outputFileTracingRoot` here (Docker ticket).
- `html lang="vi"` follows the "UI labels in Vietnamese" convention. The page text itself is a technical placeholder.

## Blocking questions
None

## Split proposal
None. This is a single scaffold slice, about 250 hand-written lines excluding the lockfile.
