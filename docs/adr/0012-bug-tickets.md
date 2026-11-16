# ADR 0012: Bug tickets `BUG-xxx` and the `/bug` command

Status: accepted (2026-11-16). Workflow only; no product code.

## Context
Bugs were filed as ordinary `STK-xxx` tickets through `/ticket`, which asks for a spec reference and has no place
for repro steps, expected vs actual behaviour, affected releases or root cause. Nothing required a fix to prove it
fixed the reported bug. The same workflow family (TuDoCuaTui, its decision D42) added a dedicated bug flow; this ADR
adapts it to stoktok's loop.

## Decision
1. **Bug tickets.** Bugs are recorded with `/bug` as `BUG-xxx` tickets (own number series, template
   `work/templates/bug.md`): Found in / Introduced in (release tags `vX.Y.Z`), environment, steps, expected, actual,
   spec reference, root cause (*confirmed* or *suspected*, with file:line) and severity. `/ticket` redirects bugs to
   `/bug`. `STK-xxx` stays for all other work.
2. **Severity → priority.** S1 = wrong money or quantity figures, a signal from stale or gapped data (R4), data
   loss, a security or auth hole, or a core flow impossible → P1. S2 = broken with a workaround, or misleading UI →
   P1 or P2. S3 = cosmetic → P3. Ming may override.
3. **Same loop.** Bugs run through `/run` unchanged (consult, plan, implement, review, rework ≤ 2, security review
   triggers). `/run` with no ID picks a `BACKLOG` S1 bug first; at equal priority a bug goes before a `STK-xxx`.
   `/status` lists open bugs by severity.
4. **Regression test.** Every bug fix ships with a regression test that fails before the fix and passes after; the
   implementer writes it first and records the failing run in impl-log; the reviewer gives REWORK without that
   evidence. Level: Vitest in the package that owns the bug (`packages/core` for money, lot, fee, tax and signal bugs
   per R1; `apps/web` components via `renderToStaticMarkup` in the node environment; `pnpm test:db` for SQL and repo
   bugs). Playwright is listed in the stack as "e2e, later" and is not a repo dependency yet: until it is, a
   browser-only bug (CSS, hydration, real browser APIs) also gets a one-off Playwright check run outside the repo,
   with its result recorded in impl-log and re-run by the reviewer.
5. **Batch branch and the A/B/C question.** `/bug` investigates read-only, dedupes against open bugs, commits the
   record on a batch branch `bug/<first ID>` (or the session's mandated branch), then asks Ming: A) open a record
   PR into `main` and stop (Ming merges, then `/run` fixes it); B) record another bug on the same branch and ask
   again; C) fix the whole batch now through the loop on that branch and open one PR. Agents never approve, merge or
   enable auto-merge.

## Consequences
- Commit messages and PR titles use the ticket ID, `STK-xxx` or `BUG-xxx` (CLAUDE.md → Conventions).
- A record PR must be merged before `/run` on `main` sees the bug; option C avoids the wait.
- Adding Playwright as a repo dependency (and turning the one-off checks into e2e tests) is a separate decision.
