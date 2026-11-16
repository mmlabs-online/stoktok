---
description: Record a bug as a BUG-xxx ticket (report, repro, expected/actual, root cause) for /run.
argument-hint: "<what is wrong> [S1|S2|S3]"
---

Record a bug from: `$ARGUMENTS` (plus any screenshot Ming attached). Rules: ADR 0012.

1. **ID**: the highest existing `BUG-xxx` in `work/tickets/` + 1, zero-padded to 3 digits (first is `BUG-001`).
   Search `work/tickets/BUG-*/ticket.md` first: if a bug that is not yet merged already covers it, add the report to
   that ticket's *Notes / answers from Ming* instead and stop.
2. **Investigate read-only** before writing (no product code changes):
   - Find the code path (file:line). Try to reproduce: a Vitest run (`pnpm --filter <package> test`), `pnpm test:db`
     for SQL or repo bugs, or a one-off Playwright check for browser-only behaviour. Record the result in
     **Root cause** as *confirmed* or *suspected*.
   - `Found in`: the release Ming named (`vX.Y.Z`), else "unknown". `Introduced in`: from `git log -S` /
     `git tag --contains <commit>` when you can tell (fetch tags first), else "unknown".
3. Create `work/tickets/<ID>/ticket.md` from `work/templates/bug.md`. All sections filled or "unknown".
   - **Severity**: S1 = wrong money or quantity figures (cost basis, P&L, fees, tax, sellable quantity), a signal
     produced from stale or gapped data (R4), data loss, a security or auth hole (R3, R6), or a core flow is
     impossible (log in, record a transaction, see the portfolio); S2 = a feature is broken but there is a
     workaround, or the UI misleads; S3 = cosmetic.
     Priority: S1 → P1, S2 → P1 or P2, S3 → P3, unless Ming said otherwise.
   - **Areas**: as in `/ticket`. Add `security` when the fix touches auth, `requireUser()`, migrations, env or
     secrets, so `/run` dispatches the security auditor.
   - Acceptance criteria always include the regression test criterion from the template.
   - Do not commit screenshots; describe them. Never copy account numbers, balances or personal data from one.
4. Append a row to the table in `work/backlog.md` (state `BACKLOG`, attempts `0`). `/run` picks S1 bugs first,
   so the row position does not matter.
5. **Commit the record on the batch branch**: `bug/<first ID>` from the latest `origin/main`, created by the first
   `/bug` of a batch (in a cloud session with a mandated branch, use that branch and say so). Later bugs of the same
   batch reuse it. Commit only `work/tickets/<ID>/ticket.md` and its `work/backlog.md` row as
   `<ID>: record bug`, then push (`git push -u origin <branch>`).
6. Show Ming the bug (short, in Vietnamese: ID, severity, what is wrong, root cause confirmed/suspected, found in /
   introduced in) and **ask with `AskUserQuestion`** (header `Bug`), listing every bug recorded in this batch so far:
   - **A. Mở PR và kết thúc** — go to 7 (record PR).
   - **B. Ghi nhận thêm bug** — reply "Mô tả bug tiếp theo (kèm ảnh nếu có)" and end the turn. Ming's next message
     is the next bug: run steps 1–6 again for it on the same batch branch (no need to type `/bug` again), then ask
     again.
   - **C. Sửa luôn rồi mở PR** — go to 8.
   An answer that is none of these (Other): follow it if clear, else ask again.
7. **Record PR** (option A): open a PR into `main` (GitHub MCP `create_pull_request`, or `gh pr create`; if one is
   open for the branch, update it). Title `<ID>: record bug — <short title>`, or `Record bugs <ID>, <ID>…` for a
   batch. Body (English, short), per bug: severity, found in / introduced in, actual vs expected in one line, root
   cause (confirmed/suspected, file:line), link to its ticket; then "Fix: `/run <ID>` after merge". The ticket's `PR`
   field stays `—` (it is for the fix PR). Report the PR link in Vietnamese and stop.
8. **Fix now** (option C): fix every bug of the batch on the batch branch, S1 first, then in record order, one at a
   time, following `/run` steps 0.2–0.3 and 0.5 through 5 (consult, plan, implement, review incl. security review,
   rework ≤ 2, the bug-ticket rules), with these differences:
   - Skip `/run` step 0.1 (selection) and 0.4 (no new `ticket/<ID>` branch): stay on the batch branch.
   - A bug whose plan is `BLOCKED` or that ends `ESCALATED` gets its plan questions / `escalation.md` committed as
     usual; continue with the others.
   - Then open **one PR** into `main` (update it if open), title `<ID>: fix <short title>` or
     `Fix bugs <ID>, <ID>…`, body as in `/run` step 6 for each `DONE` bug (summary, acceptance criteria with
     evidence, checks, needs Ming's decision, follow-ups, links), plus the bugs left `BLOCKED` / `ESCALATED` and why.
     Write the PR URL into each `DONE` ticket's `PR` row, commit `<ID>: link PR`, push.
   - Report like `/run` step 7, for every bug of the batch.
9. **Never approve, merge or enable auto-merge.** Ming merges; until then `/run` on `main` cannot see the bugs.
