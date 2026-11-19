# STK-099: Compose-side deploy guards: decoys, top-level allow-list, web/worker allow-lists (STK-097 split)

| Field | Value |
|---|---|
| State | BACKLOG |
| Priority | P2 |
| Areas | security |
| Attempts | 0 |
| Created | 2026-11-18 |
| PR | — |

## Goal
Split from STK-097 (see work/tickets/STK-097/plan.md "Split"). Compose-side hardening of `scripts/check-deploy-env.sh` for the cutover compose draft:
- STK-094 security 🟡9: decoy `migrate:` under `x-…` or a block scalar, a second YAML document after `---`/`...`, `include:`; require exactly one `migrate` key and only under `services:`; allow only `name`, `services`, `networks` (and the declared networks) at top level.
- Allow-lists for the web and worker blocks; pin the worker `profiles: [jobs]`; exact network lists (`[tunnel, db]`, `[default, db]`, `[db]`).
- 🟡6: "no internet egress" wording; consider `read_only: true` on `migrate` (and `--read-only` on the move script's `docker run … migrate`) if the migrate runner writes nothing to disk.
Changes the cutover compose draft, so if Ming wants it in v0.3.0 it must merge before the cut.

## Spec reference
CLAUDE.md R3; work/tickets/STK-094/security-review.md (attempts 1–3), review.md; work/tickets/STK-097/plan.md.

## Acceptance criteria
- [ ] Each bypass has a mutation proof that FAILs; the real draft passes.
- [ ] typecheck, lint, test, check:deploy-env green.

## Notes / answers from Ming
- 2026-11-18 (orchestrator): created from the STK-097 planner's split.
