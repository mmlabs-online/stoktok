# Solo log

| Date | Summary | Files | Checks |
|---|---|---|---|
| 2026-10-28 | CI uses Docker Hub namespace mingming21400 (matches calechip); fail-fast checks only the two secrets; README updated | .github/workflows/ci.yml, README.md | workflow YAML parses; no code changed |
| 2026-10-28 | CI: missing Docker Hub secrets on main → warning + skip push (build/smoke still run) instead of red | .github/workflows/ci.yml, README.md | workflow YAML parses; no code changed |
| 2026-10-30 | Allowlist common commands in .claude/settings.json; deny merge/auto-merge/push to main; drop ask on plain git push | .claude/settings.json | JSON valid; no code changed |
