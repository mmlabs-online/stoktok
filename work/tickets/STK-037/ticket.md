# STK-037: Release workflow and deployment-repo integration

| Field | Value |
|---|---|
| State | REWORK |
| Priority | P1 |
| Areas | architecture, security |
| Attempts | 2 |
| Created | 2026-10-30 |
| PR | — |

## Goal
Pushing a tag `vX.Y.Z` releases stoktok through the shared mmlabs deploy pattern (`mmlabs-online/deployment`, `docs/app-release.yml`): images are built and pushed, a release PR is opened on the deployment repo, and merging it deploys on the self-hosted runner. The first release is v0.1.0, public behind Cloudflare Access (Ming's answer 1, 2026-10-30).

## Spec reference
docs/spec-v1.md §7 Deployment, §4.1 Services. CLAUDE.md Stack (CI/CD, Runtime), R3, R6 note. STK-017 (images), STK-018 (compose, runbook, ADR 0003).

## Acceptance criteria
- [ ] `.github/workflows/release.yml` runs on tags `vX.Y.Z`, builds and pushes `stoktok-web` and `stoktok-worker` tagged with the version, then opens a PR `release/stoktok-vX.Y.Z` on `mmlabs-online/deployment` that changes only `apps/stoktok/release.env`, with both images pinned by digest.
- [ ] The web app has a `/healthz` route that answers without touching the database, with a test.
- [ ] `deploy/compose.stoktok.yml`, `docs/deploy.md` and ADR 0003 match the deployment repo's real conventions: external network `web`, images from `release.env`, a web healthcheck, the self-hosted runner `macbook-runner` (not WSL), and worker jobs scheduled on that Mac.
- [ ] Draft files for the deployment repo (`apps/stoktok/compose.yml`, `.github/workflows/deploy-stoktok.yml` modelled on `deploy-calechip.yml`) are prepared and opened as a separate PR on `mmlabs-online/deployment` for Ming to merge. Supabase URL and service key stay out of git, on the runner host only (R3).
- [ ] The runbook covers cutting v0.1.0 (required repo secrets, tag push, merging the release PR, rollback) and making it reachable: the Cloudflare Access application (Ming's email) is created first, then the public hostname, then access is verified. No hostname is written in either repo and no auth code is added. (Amended 2026-10-30 from "private" per Ming's answer 1.)
- [ ] `typecheck`, `lint`, `test` and the existing deploy checks pass.

## Notes / answers from Ming
- 2026-10-30: build this through a ticket and `/run`; stoktok changes in a PR here, deployment-repo files in a separate PR there.
- 2026-10-30: first release is **private** (no public hostname). Cloudflare Access before any hostname (R6 suspended).
- 2026-10-30: the runner is **macbook-runner** (`mmlabs-server` is retired); worker cron runs on the Mac.
- 2026-10-30: first version is **v0.1.0**.
- Context found in the deployment repo: cloudflared is remotely managed by a tunnel token, so hostnames and Access are set in the Cloudflare dashboard; `deploy/cloudflared-ingress.example.yml` does not apply.
- Out of scope, flagged to Ming: the deployment repo commits the tunnel token in `proxy/compose.yml` and commits `apps/calechip/.env`.
- **Answers to the architect consult's open questions (Ming, 2026-10-30):**
  1. Access to v0.1.0: **public behind Cloudflare Access** (Ming's email). No auth code in the app (R6 still suspended); Ming sets up the Access application before the hostname is added. A hard-coded admin/admin login was proposed by Ming and declined as insecure; Ming chose Access instead.
  2. Docker engine on the Mac: **OrbStack**.
  3. Mac CPU: **Intel** (amd64, no emulation). Time zone: **UTC+7** (Asia/Ho_Chi_Minh).
  4. Secrets file: a file on the Mac with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, outside git, mode 600, created by Ming (path per plan default).
  5. CI image push: **keep it**. Ming: images must be built and pushed so the deployment repo can deploy them. Do not drop CI's push.
- Depends on: STK-017, STK-018.
