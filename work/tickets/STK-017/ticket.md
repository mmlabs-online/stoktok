# STK-017: Docker images and CI build

| Field | Value |
|---|---|
| State | REVIEW |
| Priority | P2 |
| Areas | architecture, security |
| Attempts | 0 |
| Created | 2026-10-22 |
| PR | — |

## Goal
Every push to `main` is checked and produces Docker images for web and worker on Docker Hub, following the existing mmlabs pattern.

## Spec reference
docs/spec-v1.md §4.1 Services, §7 Deployment. CLAUDE.md Stack (CI/CD), R3, R8.

## Acceptance criteria
- [ ] Dockerfiles for `apps/web` (Next.js standalone output) and `apps/worker`: multi-stage, pnpm-workspace aware, non-root user.
- [ ] GitHub Actions on hosted runners runs `typecheck`, `lint`, `test` on PRs and on `main`.
- [ ] On `main`, images are built and pushed to the Docker Hub account used by other mmlabs apps, tagged with the commit SHA and `latest`.
- [ ] No secrets in images, Dockerfiles or the repo; Docker Hub credentials come from GitHub secrets; `.dockerignore` excludes `.env*` (R3).
- [ ] Both images build and start locally with a documented command.

## Notes / answers from Ming
- Depends on: STK-001.
- Input needed: none (Docker Hub account and secret names follow other mmlabs apps).
