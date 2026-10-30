# Solo log

| Date | Summary | Files | Checks |
|---|---|---|---|
| 2026-10-28 | CI uses Docker Hub namespace mingming21400 (matches calechip); fail-fast checks only the two secrets; README updated | .github/workflows/ci.yml, README.md | workflow YAML parses; no code changed |
| 2026-10-28 | CI: missing Docker Hub secrets on main → warning + skip push (build/smoke still run) instead of red | .github/workflows/ci.yml, README.md | workflow YAML parses; no code changed |
| 2026-10-30 | Allowlist common commands in .claude/settings.json; deny merge/auto-merge/push to main; drop ask on plain git push | .claude/settings.json | JSON valid; no code changed |
| 2026-10-30 | STK-037 follow-up: release.yml runs on every push to branch `release` (commit must be on main), auto-bumps patch from the last vX.Y.Z tag (v0.1.0 first) and pushes the tag itself; runbook updated | .github/workflows/release.yml, docs/deploy.md | typecheck, lint, test (core 429, db 110, worker 94, web 202), check:deploy-env all pass; workflow YAML parses |
