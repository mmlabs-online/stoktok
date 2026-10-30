# STK-037: Release workflow and deployment-repo integration

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P1 |
| Areas | architecture, security |
| Attempts | 0 |
| Created | 2026-10-30 |
| PR | — |

## Goal
Pushing a tag `vX.Y.Z` releases stoktok through the shared mmlabs deploy pattern (`mmlabs-online/deployment`, `docs/app-release.yml`): images are built and pushed, a release PR is opened on the deployment repo, and merging it deploys on the self-hosted runner. The first release (v0.1.0) is private.

## Spec reference
docs/spec-v1.md §7 Deployment, §4.1 Services. CLAUDE.md Stack (CI/CD, Runtime), R3, R6 note. STK-017 (images), STK-018 (compose, runbook, ADR 0003).

## Acceptance criteria
- [ ] `.github/workflows/release.yml` runs on tags `vX.Y.Z`, builds and pushes `stoktok-web` and `stoktok-worker` tagged with the version, then opens a PR `release/stoktok-vX.Y.Z` on `mmlabs-online/deployment` that changes only `apps/stoktok/release.env`, with both images pinned by digest.
- [ ] The web app has a `/healthz` route that answers without touching the database, with a test.
- [ ] `deploy/compose.stoktok.yml`, `docs/deploy.md` and ADR 0003 match the deployment repo's real conventions: external network `web`, images from `release.env`, a web healthcheck, the self-hosted runner `macbook-runner` (not WSL), and worker jobs scheduled on that Mac.
- [ ] Draft files for the deployment repo (`apps/stoktok/compose.yml`, `.github/workflows/deploy-stoktok.yml` modelled on `deploy-calechip.yml`) are prepared and opened as a separate PR on `mmlabs-online/deployment` for Ming to merge. Supabase URL and service key stay out of git, on the runner host only (R3).
- [ ] The runbook covers cutting v0.1.0 (required repo secrets, tag push, merging the release PR, rollback). The release is private: no public hostname, and Cloudflare Access must exist before any hostname is added.
- [ ] `typecheck`, `lint`, `test` and the existing deploy checks pass.

## Notes / answers from Ming
- 2026-10-30: build this through a ticket and `/run`; stoktok changes in a PR here, deployment-repo files in a separate PR there.
- 2026-10-30: first release is **private** (no public hostname). Cloudflare Access before any hostname (R6 suspended).
- 2026-10-30: the runner is **macbook-runner** (`mmlabs-server` is retired); worker cron runs on the Mac.
- 2026-10-30: first version is **v0.1.0**.
- Context found in the deployment repo: cloudflared is remotely managed by a tunnel token, so hostnames and Access are set in the Cloudflare dashboard; `deploy/cloudflared-ingress.example.yml` does not apply.
- Out of scope, flagged to Ming: the deployment repo commits the tunnel token in `proxy/compose.yml` and commits `apps/calechip/.env`.
- Depends on: STK-017, STK-018.
