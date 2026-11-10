# STK-072: Optional AI secrets in deploy tooling (STK-063 slice 2b-ii)

| Field | Value |
|---|---|
| State | REWORK |
| Priority | P2 |
| Areas | architecture, security |
| Attempts | 2 |
| Created | 2026-11-10 |
| PR | — |

## Goal
Make `ANTHROPIC_API_KEY` and `GOOGLE_AI_API_KEY` known to the deploy tooling as **optional** secrets, so Ming can set them once and a missing key just disables that provider. Split from STK-071 (deploy half of its AC5; see work/tickets/STK-071/plan.md "Split proposal").

## Spec reference
docs/spec-v1.md §8 secrets. CLAUDE.md R3, conventions (secrets). Design: work/tickets/STK-069/consult-software-architect.md Rec 8.

## Acceptance criteria
- [ ] `.env.example` and `docs/deploy.md` list `ANTHROPIC_API_KEY` and `GOOGLE_AI_API_KEY` with a new `optional` status (Service `web, worker`, secret `y`). `LLM_PROVIDER` / `LLM_API_KEY` are removed from both files together.
- [ ] The draft deploy workflow maps both from `STOKTOK_ANTHROPIC_API_KEY` / `STOKTOK_GOOGLE_AI_API_KEY`, with an empty-allowed charset check `^[A-Za-z0-9._-]*$` and no `missing` line. An unset secret writes `K=`.
- [ ] `check-deploy-env.sh` checks: printf keys = required ∪ optional; a `STOKTOK_` mapping for both kinds; `missing` lines only for required keys (and absent for optional ones).
- [ ] `typecheck`, `lint`, `test` green; the deploy-env check passes.

## Notes / answers from Ming
- 2026-11-10 (orchestrator): split from STK-071 per its plan.md. Independent of STK-071; STK-070 depends on both.
- Human step: Ming adds `STOKTOK_ANTHROPIC_API_KEY` and `STOKTOK_GOOGLE_AI_API_KEY` to the deployment repo's `stoktok` environment.
- 2026-11-10 (Ming, after review attempt 1 PASS): fix both 🟡 findings in security-review.md attempt 1 before the PR: (1) `check-deploy-env.sh` must pin the real guard, not just its text: the negated `if ! [[ "$K" =~ ... ]]; then` line (not a comment) followed by `exit 1`, inside the `secrets` step and before `mktemp`, for both optional keys; (2) fail if anything other than the one printf writes to `$tmp` or `$ENV_FILE`. Add matching negative cases (N11, N12, including the comment-line case the reviewer found) and run them against a scratch copy.
