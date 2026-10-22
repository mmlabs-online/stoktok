# STK-001: Scaffold pnpm workspace and tooling

| Field | Value |
|---|---|
| State | IN_PROGRESS |
| Priority | P1 |
| Areas | architecture |
| Attempts | 0 |
| Created | 2026-10-22 |

## Goal
Create the empty, buildable monorepo skeleton so every later ticket has a place to put code and a working `typecheck / lint / test` pipeline.

## Spec reference
docs/spec-v1.md §4.1 Services (`web`, `worker`), §7 Deployment; CLAUDE.md Stack.

## Acceptance criteria
- [ ] pnpm workspace with `apps/web` (Next.js, App Router, TypeScript), `apps/worker` (Node + TypeScript, no jobs yet), `packages/core` (TypeScript library).
- [ ] `apps/web` and `apps/worker` both import a trivial exported function from `packages/core`, proving the workspace link.
- [ ] Root scripts `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` run across all packages and pass.
- [ ] Vitest configured with at least one passing test in `packages/core`.
- [ ] `.env.example` lists the expected keys with empty values (Authen, app Supabase URL/anon/service role, LLM key); `.env.local` is git-ignored.
- [ ] No Dockerfiles, CI, auth, or DB code yet (separate tickets).

## Notes / answers from Ming
