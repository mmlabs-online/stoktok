## Consult: software-architect for STK-089 (worker `migrate` command, image, r3-guard, fit with STK-084)

I read `apps/worker/src/cli.ts`, `cli.test.ts`, `tsup.config.ts`, `package.json`, `apps/worker/Dockerfile`, `.dockerignore`, `scripts/check-image.sh`, `.github/workflows/ci.yml` (images job), `packages/db/src/pg/{migrate.ts,index.ts}`, `packages/db/src/r3-guard.test.ts`, ADR 0010 and `work/tickets/STK-087/plan.md`. The ticket's design holds up. The findings below are mostly sharp edges the planner should pin down.

### Findings

1. **Dir resolution works for the bundle.** tsup bundles `@stoktok/db` into `dist/` (ESM, `noExternal`). That means `import.meta.url` in the worker's `migrate.ts` resolves to a file in `/app/dist`, so `../migrations` gives `/app/migrations`. In the repo, from both `src/` and `dist/`, `../../../db/migrations` gives the repo's `db/migrations`. One side effect: inside the image the second candidate becomes `/db/migrations`, outside `/app`. That is harmless because it is only used when `/app/migrations` is missing, and then the runner exits 2 with "migrations directory not found".
2. **The unreachable-DB smoke also proves the image ships the directory.** `runMigrations` reads the directory before it connects, so a missing directory exits 2, not 1. The smoke "exit 1 with an unreachable URL" therefore also proves the directory resolved in the image. That is worth a comment in `check-image.sh`.
3. **Worker tests cannot name the env var.** r3-guard allows the literal `STOKTOK_DATABASE_URL` only in `pg/client.ts` and its test. `DATABASE_URL_ENV` is not exported from `@stoktok/db/pg` (`packages/db/src/pg/index.ts`). So `migrate.test.ts` and `cli.test.ts` in the worker cannot set or unset that var by name. Also, if `main(['migrate'])` reads `process.env` directly, a developer shell that has the URL exported would make the unit test try a real connection.
4. **The top-level `.catch` in `cli.ts` prints `e.message`** (cli.ts:166-168). If `migrateCommand` ever lets an error escape, that line becomes the leak path. The spec's "never echo unknown messages" only holds if `migrateCommand` never throws.
5. **`instanceof MigrationError` is safe.** The class is bundled once into `dist/`, with any shared chunk staying in `dist/`, and vitest resolves source. There is one copy in both cases.
6. **Dockerfile.** A `COPY --from=build /repo/db/migrations ./migrations` with no `--chown` makes the files root-owned (755/644), so `node` can read but not write them. `README.md` comes along too, which is fine: the runner ignores non-`.sql` files and it is a regular file. `.dockerignore` does not exclude `db`. `db/rollback/20261111000200_baseline.down.sql` is only in the build stage, not the runtime stage. No change to `.dockerignore` is needed.
7. **Order inside `check-image.sh`.** The worker block ends with `exit 0` (line 50) and sets `trap … EXIT` for `$NAME` (line 38). New steps must go before line 50. A second named container needs its own name with the trap extended, or the existing `$NAME` reused after the signals run is gone.
8. **The r3-guard rule has to allow the barrel.** `pg/index.ts` exports `runMigrations` and `migrateFromEnv`, so the barrel itself mentions both names.
9. **Fit with STK-084.**
   - The ENTRYPOINT is `node dist/cli.js`, so the compose service is just `image: <same worker digest>`, `command: ["migrate"]`, `restart: "no"`, `networks: [db]`, `profiles: [migrate]`, run as `docker compose run --rm migrate`. Its exit code passes through and gates the app swap.
   - The `migrate` path needs only `STOKTOK_DATABASE_URL`. It never calls `createPgDb`, so the AI master key is not required.
   - No worker module reads env at import time (only `cli.ts:66` and `ai.ts:10`, both lazily).
10. **Release rule.** Merging STK-089 makes CI on `main` push a new `:latest` worker image. The change only adds a subcommand and a directory, and `release.yml` deploys by digest. So production stays unchanged, and no release is cut.

### Recommendations

- **R-1 (testability; findings 3–4; R3/R8):** give `main` a way to inject the migrate dependencies, for example a third optional parameter `migrateDeps?: { env; dir; run }`, defaulting to `process.env`, `resolveMigrationsDir(dirname(fileURLToPath(import.meta.url)), existsSync)` and `migrateFromEnv`. Alternatively, `vi.mock('./migrate')` in `cli.test.ts`. Then:
  - `cli.test.ts` checks that `main(['migrate'], openDbSpy, { env: {}, … })` sets exit 2 and that `openDbSpy` is never called;
  - `migrate.test.ts` passes `env: {}` and fake `run` functions;
  - no test touches the real env var or the network.
- **R-2 (finding 4; R3):** wrap the whole body of `migrateCommand` in try/catch so it never rejects. Add a test where `run` rejects with `new Error('postgres://u:SENTINEL@127.0.0.1/x')` and assert that neither stdout nor stderr (spied) contains `SENTINEL` or `127.0.0.1`. Also test a `run` that throws synchronously.
- **R-3 (finding 1):** in `resolveMigrationsDir` tests, inject `exists` and assert three cases:
  - image layout `/app/dist` gives `/app/migrations`;
  - repo `apps/worker/src` and `apps/worker/dist` give `<root>/db/migrations`;
  - when nothing exists, it returns the first candidate.

  Use `path.resolve` throughout and normalise expectations with `resolve()` so the tests pass on Windows too.
- **R-4 (finding 6, ADR 0010 §9):** in the Dockerfile, put the `COPY` after the `dist` copy and before `USER node`, with no `--chown`. Add a one-line comment: "root-owned, read-only for node; db/rollback is never copied".
- **R-5 (`check-image.sh`, findings 2 and 7; ticket "only regular files"):** add these steps before line 50:
  - `docker run --rm IMAGE migrate` must exit 2 with non-empty stderr.
  - The unreachable-URL run uses `timeout 20` and `--name "$NAME-mig"`, with the trap extended to remove both containers. It must exit 1, must not exit 124, and the output must not contain `smoke-pw` or `127.0.0.1`.
  - One `--entrypoint sh` run as `--user 0`:
    - `test -f /app/migrations/20261111000200_baseline.sql`;
    - `find /app/migrations -mindepth 1 ! -type f` is empty;
    - `find /app/migrations -name '*.down.sql'` is empty.
  - One `--entrypoint sh` run as the default user (`node`): `! test -w /app/migrations`. This makes the "read-only for node" claim checkable.
  - Verify locally with `bash -n scripts/check-image.sh`; CI's `images` job runs it on the PR.
- **R-6 (r3-guard, from the STK-087 security review):** add a test that `\b(runMigrations|migrateFromEnv)\b` appears only in:
  - `packages/db/src/pg/{migrate,migrate.test,index}.ts`;
  - `packages/db/test-db/**`;
  - `apps/worker/src/migrate.ts`;
  - `apps/worker/src/{migrate,cli}.test.ts`, but only if those tests actually name them.

  Also assert that no path starting `apps/web/` mentions them. Add regex self-tests: `runMigrationsX` must not match and `await migrateFromEnv(` must match. Keep `cli.ts` itself out of the allowlist so the delegation always goes through `apps/worker/src/migrate.ts`.
- **R-7 (USAGE and output streams):** add `migrate` to `USAGE` as a separate form, `| migrate (no flags)`. Migrate logs go to stdout and errors to stderr, as the ticket says. That differs from the other jobs, which log to stderr, so document it in the README. `docker compose logs` captures both.
- **R-8 (docs):** in the worker or `db/migrations` README, document the local run: `pnpm --filter @stoktok/worker job migrate`, which uses the repo path through tsx with `.env.local`. Also document the compose contract for STK-084 from finding 9 and the exit-code table: 0 means applied, up to date or ahead; 1 is a runtime failure; 2 is a configuration error.

### Risks

- **"Database ahead" exits 0** (TuDo behaviour). If the deploy rolls back to an older image after a newer migration, `migrate` passes with only a warning, and the old app runs against the newer schema. That is safe only with expand/contract migrations. STK-084 should decide whether the deploy treats this case as OK.
- **Lock contention at deploy time.** A running worker job holding table locks makes the per-file `lock_timeout 10s` fire, so migrate exits 1 and the deploy aborts with the old release still running. That is the correct fail-safe, but STK-084 should stop the worker or schedule deploys away from job times, or accept a retry.
- **Fallback directory `/db/migrations` in the image.** A stray volume mount at `/db/migrations` would be picked up only if `/app/migrations` were missing. The image always ships `/app/migrations` and `check-image` asserts it, so the risk is very low.
- **CI-only proof for the image.** Docker is not available in the session, so a mistake in `check-image.sh` only shows up in the PR's `images` job. Expect a possible rework round there.

### Open questions (each with a proposed default)

1. Should "database ahead" get its own exit code, such as 3, so STK-084's deploy can tell it apart? Default: no. Keep 0 plus a warning, as in TuDo, and record the expand/contract expectation in the README. This is reversible.
2. Should `main` take injected migrate dependencies, or should `cli.test.ts` use `vi.mock('./migrate')`? Default: the optional third parameter (R-1). It is explicit, mirrors the existing `openDb` injection, and avoids module mocking.
3. Should the image copy only `*.sql` instead of the whole directory? Default: the whole directory. It is simpler, and `README.md` is a harmless regular file the runner ignores.

Relevant files: `apps/worker/src/cli.ts`, `apps/worker/src/cli.test.ts`, `apps/worker/tsup.config.ts`, `apps/worker/Dockerfile`, `.dockerignore`, `scripts/check-image.sh`, `packages/db/src/pg/migrate.ts`, `packages/db/src/pg/index.ts`, `packages/db/src/r3-guard.test.ts`, `docs/adr/0010-self-hosted-postgres-data-layer.md`, `.github/workflows/ci.yml`.
