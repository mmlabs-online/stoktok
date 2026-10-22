---
description: Create a new ticket in work/ from a short description.
argument-hint: "<description> [P1|P2|P3]"
---

Create a ticket from: `$ARGUMENTS`

1. Read `work/backlog.md`. The new ID is the highest existing `STK-xxx` + 1 (start at `STK-001`), zero-padded to 3 digits.
2. Create `work/tickets/<ID>/ticket.md` from `work/templates/ticket.md`:
   - **Goal**: one or two sentences, in English.
   - **Spec reference**: the section(s) of `docs/spec-v1.md` this ticket implements. If none fits, say so and ask Ming whether it is in scope before creating the ticket.
   - **Acceptance criteria**: 3–7 testable bullets derived from the description and the spec. Do not invent requirements.
   - **Areas**: any of `finance`, `architecture`, `db`, `data`, `ui`, `security` that genuinely apply.
   - **Priority**: from the argument if given, else `P2`.
   - State `BACKLOG`, attempts `0`.
3. Append a row to the table in `work/backlog.md`.
4. If the description clearly contains more than one deliverable, propose a split instead of creating one large ticket, and ask Ming which to create.
5. Do not commit. Show Ming the ticket in a short Vietnamese summary.
