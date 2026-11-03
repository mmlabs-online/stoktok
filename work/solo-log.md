# Solo log

| Date | Summary | Files | Checks |
|---|---|---|---|
| 2026-10-28 | CI uses Docker Hub namespace mingming21400 (matches calechip); fail-fast checks only the two secrets; README updated | .github/workflows/ci.yml, README.md | workflow YAML parses; no code changed |
| 2026-10-28 | CI: missing Docker Hub secrets on main → warning + skip push (build/smoke still run) instead of red | .github/workflows/ci.yml, README.md | workflow YAML parses; no code changed |
| 2026-10-30 | Allowlist common commands in .claude/settings.json; deny merge/auto-merge/push to main; drop ask on plain git push | .claude/settings.json | JSON valid; no code changed |
| 2026-10-30 | STK-037 follow-up: release.yml runs on every push to branch `release` (commit must be on main), auto-bumps patch from the last vX.Y.Z tag (v0.1.0 first) and pushes the tag itself; runbook updated | .github/workflows/release.yml, docs/deploy.md | typecheck, lint, test (core 429, db 110, worker 94, web 202), check:deploy-env all pass; workflow YAML parses |
| 2026-11-03 | STK-043 follow-up: deploy secrets renamed to STOKTOK_SUPABASE_URL / STOKTOK_SUPABASE_SERVICE_ROLE_KEY (deployment repo is shared); mapped to SUPABASE_* in the env file | deploy/deployment-repo/.github/workflows/deploy-stoktok.yml, docs/deploy.md | check:deploy-env, check:service-key, lint, typecheck, test (core 494, db 117, worker 174, web 214) pass; YAML parses |
