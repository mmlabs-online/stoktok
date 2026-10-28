# Security review: STK-017, attempt 1

**Verdict: no 🔴 blocking findings.** Credential handling, permissions, the PR/fork split, script injection, non-root runtime, `.dockerignore` and R3 all hold up. There are 3 🟡 should-fix items, which are hardening, not exploitable bugs today. As instructed, I did not flag R6.

**What I read:** ticket.md, plan.md and the full files `.github/workflows/ci.yml`, `apps/web/Dockerfile`, `apps/worker/Dockerfile`, `.dockerignore`, `.gitignore`, `apps/web/next.config.ts`, plus the README Docker section and `scripts/check-no-service-key-in-client.sh`. I had no shell, so I could not run `git diff origin/main...HEAD` and reviewed the current file contents instead.

## Findings

### 🔴 Blocking
None.

### 🟡 Should-fix

1. **"Secrets only on main push" is enforced only by the workflow file itself, and a PR branch can edit that file.** `.github/workflows/ci.yml:58,62,75,124`
   - The `PUSH` condition is correct. But `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are repo-level secrets.
   - Fork PRs don't get secrets. Same-repo PRs do: any `ticket/STK-xxx` branch pushed by the agent loop can change `if:` or add `echo $TOKEN | base64` and read the token on its `pull_request` run.
   - In this repo an AI agent pushes branches without a human gate, so that is a real path, even though it needs a misbehaving agent or a compromised dependency/action.
   - Fix (settings plus a small YAML change):
     - Create a GitHub Environment `dockerhub` with a deployment branch policy of `main` only, and move the two secrets into it.
     - Put login and push in a separate `push` job with `needs: images`, `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` and `environment: dockerhub`.
     - Then a PR branch cannot get the token even if it rewrites the workflow.
   - Cheaper interim step: a Docker Hub access token scoped Read & Write to only the `stoktok-*` repos, so a leak is limited to those repos.

2. **Third-party actions are pinned to moving tags, including the one that handles the token.** `ci.yml:35-37,60,73,76,80`
   - `docker/login-action@v3` receives the Docker Hub token. `docker/setup-buildx-action@v3` and `docker/build-push-action@v6` run after login in the same job. `pnpm/action-setup@v4` is a third-party action.
   - A retagged or compromised tag (the tj-actions/changed-files incident, 2025) could exfiltrate the token.
   - Fix: pin at least `docker/login-action`, `docker/build-push-action`, `docker/setup-buildx-action` and `pnpm/action-setup` to full commit SHAs with a `# vX.Y.Z` comment, and add Dependabot for `github-actions`.
   - The plan lists this as an optional follow-up. I recommend doing it in this diff, at least for the actions that can see the token.

3. **Login happens before build and smoke run, so credentials sit on the runner longer than needed.** `ci.yml:74-79` vs. `123-127`
   - The build step uses `push: false`, `load: true` and doesn't need auth. Yet `~/.docker/config.json` holds the token while two third-party actions and the smoke `docker run`s execute.
   - Fix: move "Docker Hub login" to just before "Push images". This is a one-line reorder and pairs naturally with the separate push job in item 1.

### 💭 Notes (verified OK or low risk)

- **Triggers and permissions are fine.**
  - Uses `pull_request`, not `pull_request_target`.
  - Top-level `permissions: contents: read`; no `id-token` and no write scopes.
  - Fork PRs build and smoke-test without secrets or login.
- **No script injection.**
  - The only `${{ }}` values inside `run:` are `matrix.app` (a static list) and `github.sha`.
  - `DOCKERHUB_NAMESPACE` reaches the shell through `env` (`ci.yml:17,72`), and only an admin can set it.
  - No PR title, branch name or body is ever interpolated.
- **No secret in logs.**
  - The fail-fast step passes secrets through step `env` and never echoes them (`ci.yml:63-70`).
  - The Postgres `postgres:postgres` password and `SUPABASE_SERVICE_ROLE_KEY=dummy` are throwaway values. Printing them via `docker logs web` exposes nothing.
- **Dockerfiles carry no secrets.**
  - No `ARG` anywhere. `ENV` holds only `NODE_ENV`, `PORT`, `HOSTNAME` and `NEXT_TELEMETRY_DISABLED`.
  - Multi-stage builds: the runtime stage copies only standalone/static output (web) or dist plus prod node_modules (worker). The build stage, where `COPY . .` happens, is never shipped.
- **Non-root runtime:** `USER node` in both images (`apps/web/Dockerfile:26`, `apps/worker/Dockerfile:27`).
  - Hardening option: the app files are `--chown=node:node`, so a compromised process could rewrite its own code. You could copy them root-owned and give `node` write access only to `apps/web/.next/cache` if Next needs it. Low priority.
- **`.dockerignore` covers env files.**
  - `.env*` and `**/.env*` with `!.env.example`, plus `.git`, `.claude`, `work` and `docs`. That also stops Next standalone from copying a local `.env` into the image.
  - Defensive additions worth considering: `**/*.pem`, `**/*.key`, `**/.npmrc` (no `.npmrc` exists today).
- **`.gitignore`:** `.env*` plus `!.env.example` is correct.
- **R3 (service-role key never in the browser bundle) holds.**
  - The image build runs with no env at all, so nothing can be inlined.
  - `check:service-key` runs in CI and greps `.next/static` for a sentinel key.
  - There is no `NEXT_PUBLIC_` key, and `next.config.ts` adds only `output` and `outputFileTracingRoot`.
- **The in-image secret scan is useful but limited** (`ci.yml:91-98`). It checks env-var names and `.env*` files only, not file contents or secret-named files such as `*.pem`. That is acceptable given the no-ARG multi-stage design.
- **The GHA build cache is not a poisoning risk.** PR-scoped cache entries can't be read by `main` runs; `main` reads only its own and the default branch's cache.
- **Concurrency on `main`:** `cancel-in-progress: true` can cancel a `main` run between the two `docker push` calls. The SHA tag would then be pushed but `latest` not updated. That's reliability, not security; consider `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`.
- **Base images:** `node:22-bookworm-slim` is not digest-pinned, and corepack fetches `pnpm@10.28.0` at build time with no hash in `packageManager`. Low risk; Dependabot for docker plus a digest pin would close it.

## Recommendations
- **AC4 / R3:** finding 1 (Environment-scoped secrets and a separate push job gated to `main`) plus finding 3 (login just before push). Together they make "Docker Hub creds only on main push" enforced by GitHub, not just by the YAML.
- **AC4:** finding 2, pin the token-handling and third-party actions to SHAs.
- **AC4, optional:** add `**/*.pem`, `**/*.key` and `**/.npmrc` to `.dockerignore`.
- If the reviewer wants to keep this diff minimal (R7), findings 1 and 2 could become follow-ups. But finding 3 is a trivial reorder and belongs in this diff.

## Risks
- Until finding 1 is done, any workflow run from a same-repo branch, including the agent loop's own PR runs, can read the Docker Hub token by editing `ci.yml`.
- With tag-pinned actions, the token's safety depends on upstream maintainers' tag hygiene.
- If the Docker Hub repos are **public**, the compiled app (including server code) is public, even though the app repo is private per spec §7. The images contain no secrets, but code and dependency versions are exposed.

## Open questions (for Ming)
1. Will the `stoktok-web` and `stoktok-worker` Docker Hub repos be private? I recommend private.
2. Is it OK to use a GitHub Environment (`dockerhub`, `main` only) for the secrets? This needs repo-settings access, which only Ming has.
3. Can the Docker Hub token be repo-scoped to the stoktok repos (a Docker Hub org access token or a repo-limited PAT), rather than a broad account token shared with the other mmlabs apps?
