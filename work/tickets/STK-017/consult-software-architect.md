# STK-017 consult: software-architect

## Findings
- **Workspace:** pnpm@10.28.0 (`packageManager`), Node 22 (`.node-version`, `engines >=22`). `pnpm-lock.yaml` is present. `onlyBuiltDependencies: esbuild, sharp`. `@stoktok/core` and `@stoktok/db` are source-only packages (`exports: ./src/index.ts`) with no build step. `db` depends on `@supabase/supabase-js`.
- **Web** (`apps/web/next.config.ts`): only `transpilePackages: ['@stoktok/core','@stoktok/db']`. There is no `output: 'standalone'`, no `outputFileTracingRoot` and no `public/` dir. All data pages are `force-dynamic`. `apps/web/server/db.ts` creates the client lazily from `process.env` at runtime, so the build should not need DB env. The planner should confirm by running `next build` with no env.
- **Worker** (`apps/worker`): `tsup` bundles `src/index.ts` and `src/cli.ts` to ESM node22, with `noExternal` for core/db. `@supabase/supabase-js` stays external, so the runtime image still needs a prod `node_modules` for it. `start:job` = `node dist/cli.js` already exists. `cli.ts` is a one-shot CLI (`eod-prices|financials|signals [--dry-run]`) that exits 0/1, or 2 on usage. `index.ts` is still the scaffold log line. **No scheduler exists anywhere.** `createServiceClient` throws when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are missing, even with `--dry-run`. Timezone (Asia/Ho_Chi_Minh) is handled explicitly in core, so the container TZ doesn't matter.
- **`scripts/check-no-service-key-in-client.sh`** runs its own `next build` with a sentinel key and greps `apps/web/.next/static`. **`scripts/db-check.sh`** uses `DB_CHECK_URL`, which must point to localhost (it refuses other hosts), or else a throwaway `initdb` (needs PG16 binaries). It also needs `psql` on PATH.
- **Gaps:** `.gitignore` covers `.env`, `.env.local` and `.env.*.local`, but not `.env.production` and similar. There is no `.dockerignore` and no `.github/`.
- **Spec conflict:** spec §4.1 calls the worker a "scheduler" service, but the code is one-shot jobs only. §7 also requires restart tolerance.

## Recommendations
1. **Web Dockerfile** (AC1)
   - Add `output: 'standalone'` and `outputFileTracingRoot: <repo root>` to `next.config.ts`. It's an ESM `.ts` config, so use `fileURLToPath(new URL('../../', import.meta.url))`.
   - Stages:
     - `base`: `node:22-bookworm-slim` + `corepack enable`. Use glibc because of sharp.
     - `deps`: copy only the lockfile, workspace yaml and package.jsons, then `pnpm install --frozen-lockfile` with a BuildKit cache mount on the pnpm store.
     - `build`: copy the source, then `pnpm --filter @stoktok/web build` with `NEXT_TELEMETRY_DISABLED=1`.
     - `runtime`: copy `.next/standalone/` to `/app`, and `.next/static` to `/app/apps/web/.next/static`. Set `ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000`, `USER node`, `EXPOSE 3000`, `CMD ["node","apps/web/server.js"]`.
   - **No `ARG`/`ENV` for any secret.** All env is supplied at runtime by the deploy repo (R3, spec §7).
2. **Worker Dockerfile** (AC1)
   - Use the same `base`/`deps` stages, then `pnpm --filter @stoktok/worker build`.
   - Produce prod deps with `pnpm --filter @stoktok/worker deploy --prod --legacy /out`. pnpm 10 needs `--legacy` unless `inject-workspace-packages` is set.
   - Runtime: `/out/node_modules` + `dist/`, `USER node`, `ENTRYPOINT ["node","dist/cli.js"]`.
   - **Use the compiled output, not tsx.** tsx needs devDeps, adds startup transpile and makes a bigger attack surface. `start:job` already targets `dist`.
   - Alternative if `deploy` is awkward: set tsup `noExternal: [/.*/]` so the image only needs `dist/` + node. That is a one-line config change, but it should be noted.
3. **Scheduling stays out of the image** (R7)
   - One-shot entrypoint per job: `docker run <img> eod-prices`. Who triggers it (host cron, the deploy repo's scheduler, or an in-process scheduler in `index.ts`) is decided in STK-018 or a new ticket. Add it to follow-ups.
   - Don't add node-cron here: it's a new feature and needs idempotency/resume work (spec §7).
   - Document that a one-shot container must not use `restart: always`.
4. **`.dockerignore`** (AC4)
   - Exclude: `**/node_modules`, `**/.next`, `**/dist`, `coverage`, `.git`, `.github`, `.claude`, `work`, `docs`, `supabase`, `*.log`, `.env*` with `!.env.example`, `**/.env*`, `*.tsbuildinfo`.
   - Also widen `.gitignore` to `.env*` + `!.env.example`.
5. **CI `.github/workflows/ci.yml`** (AC2, R8)
   - Triggers: `pull_request` and `push: [main]`. Settings: `permissions: contents: read`, plus a `concurrency` group.
   - Steps:
     - `pnpm/action-setup` reads `packageManager`.
     - `actions/setup-node` with `node-version-file: .node-version` and `cache: pnpm`.
     - `pnpm install --frozen-lockfile`
     - `pnpm typecheck`, `lint`, `test`
     - `pnpm check:service-key` (R3; it does the web build, so no separate build step is needed)
     - `pnpm db:check`: use a `services: postgres:16` container with `POSTGRES_PASSWORD`, a health check and port 5432, and set `DB_CHECK_URL=postgresql://postgres:postgres@localhost:5432/postgres`. The ubuntu runner already has `psql`. That throwaway password is not a secret.
6. **Image job** (AC3)
   - Can live in the same or a separate workflow. Set `needs: ci` and `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`. Use a matrix over `{web, worker}`, with `docker/setup-buildx-action`, `docker/login-action` and `docker/build-push-action` (`context: .`, `file: apps/<app>/Dockerfile`, GHA cache).
   - Tags: `${NS}/stoktok-<app>:${{ github.sha }}` and `:latest`.
   - Optional: on PRs, build without pushing to catch Dockerfile breaks before main.
7. **Parametrizing unknowns safely**
   - Namespace comes from a repo **variable** `vars.DOCKERHUB_NAMESPACE`. It isn't sensitive, so a variable avoids masking problems in tags.
   - Credentials come from `secrets.DOCKERHUB_USERNAME` and `secrets.DOCKERHUB_TOKEN` (the docker/login-action convention; use a read/write access token, not the password).
   - Put all three names in one `env:` block at the top of the workflow. Add a fail-fast step that errors clearly if any is empty, rather than pushing to a wrong or empty namespace.
   - List the names in the README so Ming can rename them to match the mmlabs pattern in one place.
8. **Local run doc** (AC5)
   - README section: `docker build -f apps/web/Dockerfile -t stoktok-web .` and `docker run --rm -p 3000:3000 --env-file apps/web/.env.local stoktok-web`.
   - Worker: `docker run --rm stoktok-worker` should print usage and exit 2 (this proves it starts without secrets). The real run is `docker run --rm --env-file apps/worker/.env.local stoktok-worker eod-prices --dry-run`.
   - Note: `--env-file` is runtime-only, so nothing gets baked into the image.
9. **Extra R3 guard (cheap):** in the image job, after the build, run `docker image inspect` and assert that `Config.Env` contains no `*KEY*`/`*SECRET*` entries.

## Risks
- **Standalone tracing in a pnpm monorepo:** without `outputFileTracingRoot`, Next may infer the wrong root and miss pnpm symlinked deps such as `@supabase/supabase-js`. Verify by starting the container and loading a `force-dynamic` page against a real or dummy URL.
- **`pnpm deploy`** behaviour changed in v10 (`--legacy` / `inject-workspace-packages`). If it's misconfigured, the worker image fails at runtime with `ERR_MODULE_NOT_FOUND` even though the build passed. Smoke-test with `docker run … ` (no args).
- **`latest` on main** can be pulled by accident during deploys. Rollback must use SHA tags (STK-018 runbook).
- **Spec wording mismatch:** a "scheduler" service vs one-shot jobs. If STK-018 assumes a long-running worker, a container with a restart policy will loop.
- **Platform:** runners are amd64. If Ming's server were ARM, multi-arch would be needed (WSL2 on a PC is almost certainly amd64).
- **Public exposure:** shipping images doesn't expose anything. Exposure only happens at STK-018 (auth suspended, R6 note).

## Open questions (for Ming)
1. Docker Hub namespace and the exact GitHub secret names used by other mmlabs apps. Proposal: `vars.DOCKERHUB_NAMESPACE`, `secrets.DOCKERHUB_USERNAME`, `secrets.DOCKERHUB_TOKEN`. Not blocking, since the workflow fails fast until they're set.
2. Image naming convention: `<ns>/stoktok-web` + `<ns>/stoktok-worker`, or a single repo `<ns>/stoktok` with tags like `web-<sha>`? And the full SHA, or short `sha-xxxxxxx`?
3. Should PRs also build images without pushing? It costs CI minutes but catches Dockerfile breaks before main.
4. Who schedules worker jobs in production (host cron, a deploy-repo scheduler, or an in-process scheduler)? Proposal: defer to STK-018 or a new ticket.
