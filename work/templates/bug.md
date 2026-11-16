# BUG-xxx: <short description of the wrong behaviour>

| Field | Value |
|---|---|
| Type | bug |
| State | BACKLOG |
| Severity | S1 / S2 / S3 |
| Priority | P1 |
| Areas | <finance, architecture, db, data, ui, security> |
| Found in | vX.Y.Z (production) / local dev / unknown |
| Introduced in | vX.Y.Z (<STK-xxx or commit>) / unknown |
| Attempts | 0 |
| Created | YYYY-MM-DD |
| PR | — |

## Report
<What Ming saw, in Ming's words (quote), and the date. Screenshot: describe it; never commit it, and never copy
account numbers, balances or other personal data from it.>

## Environment
- Where: production (stoktok.mmlabs.online) / local `pnpm dev` / worker job `<name>` · Browser and device · Viewport

## Steps to reproduce
1. …

## Expected
- …

## Actual
- …

## Spec reference
<docs/spec-v1.md section that defines the expected behaviour, or "none — expected behaviour comes from the report".>

## Root cause
<file:line and why, once known; "unknown — planner investigates" otherwise. Mark it **confirmed** (reproduced) or
**suspected**.>

## Scope
- Fix the cause above; nothing else (R7).

## Out of scope
- …

## Acceptance criteria
- [ ] A regression test reproduces the bug: it fails on `main` before the fix and passes after (name the test).
- [ ] The expected behaviour above holds.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass (and `pnpm test:db` when the fix touches SQL or `packages/db`).

## Technical notes
- Files: …
- Test level (ADR 0012): Vitest unit test in the package that owns the bug — `packages/core` for any money, lot, fee,
  tax or signal bug (R1); `apps/web` components rendered with `renderToStaticMarkup` (node environment, no DOM);
  `pnpm test:db` for SQL, migration or repo bugs. Browser-only behaviour (CSS, hydration, real browser APIs) is
  invisible to these: add a one-off Playwright check (outside the repo, result recorded in impl-log) until Playwright
  e2e is a repo dependency.

## Notes / answers from Ming
