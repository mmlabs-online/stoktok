# stoktok

Personal stock tracking and investment assistant for the Vietnamese market. Part of mmlabs.

- Scope: [docs/spec-v1.md](docs/spec-v1.md)
- How Claude Code works in this repo (stack, rules, workflow): [CLAUDE.md](CLAUDE.md)

## Workflow quick start
```
/ticket "Add CSV import for TCInvest statements" P2   # create a ticket
/run STK-001                                          # plan → implement → review, automatically
/status                                               # board summary
```
Each ticket runs on branch `ticket/STK-xxx`. Review the result and merge into `main` yourself.

> Reference only — not investment advice.

## CI and Docker images
GitHub Actions (`.github/workflows/ci.yml`, hosted runners) runs typecheck, lint, test, `check:service-key` and `db:check` on PRs and on `main`. Both images are then built and smoke-tested; on `main` only, they are pushed to Docker Hub.

Set in the repo settings (same secret names as the other mmlabs apps):
- secrets `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` (an access token with read/write, not the password)

The Docker Hub namespace `mingming21400` is declared once at the top of `ci.yml`. Until both secrets are set, `main` still builds and smoke-tests the images but skips the push with a warning.

Images: `mingming21400/stoktok-web` and `mingming21400/stoktok-worker`, tagged with the full commit SHA and `latest`. Roll back by deploying an older SHA tag.

Build and run locally (env is runtime-only, never baked into images):
```
docker build -f apps/web/Dockerfile -t stoktok-web .
docker run --rm -p 3000:3000 --env-file apps/web/.env.local stoktok-web
docker build -f apps/worker/Dockerfile -t stoktok-worker .
docker run --rm stoktok-worker            # prints usage, exits 2
docker run --rm --env-file apps/worker/.env.local stoktok-worker eod-prices --dry-run
```
The worker is one-shot: one container run per job. Do not give it `restart: always`. Scheduling and deployment: see `docs/deploy.md` and `docs/adr/0003-deploy-and-scheduling.md`.
