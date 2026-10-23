---
description: Run the full plan → implement → review loop for one ticket, dispatching subagents automatically.
argument-hint: "[STK-xxx]"
---

<!-- Orchestration logic adapted from agency-agents: specialized/agents-orchestrator.md and strategy/coordination/handoff-templates.md (MIT).
     The orchestrator is this command running in the main session, because subagents cannot dispatch subagents. -->

You are the **orchestrator** for ticket `$ARGUMENTS`. You dispatch subagents and keep the board true. You write **no product code, no plan, no review** yourself — only ticket state, backlog rows, consult files, and the escalation report.

## 0. Select and prepare
1. If `$ARGUMENTS` is empty, pick the `BACKLOG` ticket in `work/backlog.md` with the highest priority (P1 > P2 > P3), then the lowest ID. If none, report "Nothing in BACKLOG" and stop.
2. Read `work/tickets/<ID>/ticket.md`. Refuse to run if state is `DONE` or `ESCALATED` (tell Ming why). A `BLOCKED` ticket may run only if its blocking questions now have answers in ticket.md.
3. Make sure the working tree is clean (`git status --porcelain`). If not, stop and report.
4. Create or switch to branch `ticket/<ID>` from the latest `main` (`git fetch origin main` first). If the environment mandates a different working branch (e.g. a cloud session's designated branch), use that branch instead and say so in the report.
5. Set state `PLANNING` in ticket.md and backlog.md.

## 1. Consult (only for the ticket's `areas`)
| Area | Subagent |
|---|---|
| finance | `finance-investment-researcher` |
| architecture | `software-architect` |
| db | `database-optimizer` |
| data | `data-engineer` |
| ui | `data-visualization-engineer` |

Dispatch the matching specialists **in parallel**, each with: the ticket path, "consult mode, read-only, return Findings / Recommendations / Risks / Open questions". Save each reply verbatim to `work/tickets/<ID>/consult-<agent>.md`. Skip this step if `areas` has none of the above.

## 2. Plan
Dispatch `planner` with the ticket path. When it returns, read `plan.md`:
- `Status: BLOCKED` → set state `BLOCKED`, commit `work/` changes (`STK-xxx: plan blocked`), push the branch (no PR), and **stop**: show Ming the blocking questions.
- `Status: READY` → set state `IN_PROGRESS`, commit `work/` (`STK-xxx: plan`), continue. (No human approval gate — Ming's decision.)

## 3. Implement
Dispatch `implementer` with: ticket path, "implement plan.md; attempt N". Verify impl-log.md has a new attempt section; if not, treat as a failed attempt.

## 4. Review
Set state `REVIEW`. Then:
1. Decide whether security review is needed: `areas` contains `security`, **or** the diff (`git diff --name-only main...HEAD`) touches any of: `supabase/`, `**/auth*`, `**/middleware*`, `**/*.sql`, `.env.example`, `**/supabase*`, server actions or API routes. If yes, dispatch `security-ai-generated-code-auditor` **in parallel** with the reviewer and save its reply to `security-review.md` (append per attempt).
2. Dispatch `reviewer` with the ticket path and attempt number.
3. Read the latest section of `review.md`. The verdict is the first line: `Verdict: PASS` or `Verdict: REWORK`.
4. A 🔴 finding in `security-review.md` turns a PASS into REWORK: append it to the review attempt under "Security blockers".

## 5. Loop decision
- **PASS** → set state `DONE`, update backlog row (state, attempts, updated date), commit `work/` (`STK-xxx: done`). Go to 6.
- **REWORK** and reworks so far < 2 → increment `attempts` in ticket.md, set state `REWORK`, dispatch `implementer` with "REWORK attempt N: fix only the issues in the latest review.md section", then return to step 4.
- **REWORK** and reworks so far = 2 → set state `ESCALATED`, write `work/tickets/<ID>/escalation.md` from `work/templates/escalation.md` (what failed each attempt, root-cause guess, options for Ming), commit, push the branch (no PR), and **stop**.

## 6. Open the pull request (DONE only)
1. Push the branch: `git push -u origin <branch>`.
2. Open a PR into `main` (GitHub MCP `create_pull_request`, or `gh pr create`). If a PR for this branch is already open, update it instead of opening a second one.
   - Title: `STK-xxx: <ticket title>`.
   - Body (English, short):
     - **Summary**: what changed, 2–4 bullets.
     - **Acceptance criteria**: the ticket's checklist, each ticked with one line of evidence from `review.md`.
     - **Checks**: `typecheck` / `lint` / `test` (+ any ticket-specific check) results from the review.
     - **Needs Ming's decision**: spec divergences and planner defaults to confirm (or "none").
     - **Follow-ups**: from impl-log, review and security-review.
     - Links to `plan.md`, `review.md`, `security-review.md` in the ticket folder.
3. Write the PR URL into ticket.md (`| PR | <url> |` row in the field table), commit `STK-xxx: link PR`, and push.
4. **Never approve, merge or enable auto-merge.** Ming reviews and merges the PR.

## 7. Report to Ming
Short summary in Vietnamese: ticket, final state, attempts, files changed (`git diff --stat main...HEAD`), check results, follow-ups the agents listed, and the next step: the PR link to approve and merge, or the escalation / blocking questions.

## Guardrails
- Pass each subagent only what it needs (paths, attempt number, the exact instruction). Do not paste whole files into prompts.
- Never edit `plan.md`, `impl-log.md` or `review.md` to change an outcome.
- If a subagent fails or returns nothing twice in a row, set `ESCALATED` with the reason and stop.
