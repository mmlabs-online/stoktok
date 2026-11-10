# STK-072 security review

## Security review: STK-072, attempt 1 (optional AI secrets in deploy tooling)

**Verdict: no 🔴 findings.** The workflow is safe against env-file injection, value swaps and log leaks. The two 🟡 findings are gaps in `check-deploy-env.sh`: a workflow that is actually unsafe could still pass it. Neither is exploitable as the code stands now.

I had no shell, so I read the four files directly and did not run `git diff`, the script or the negative cases N1–N10.

### Findings
- 🟢 **Injection blocked.** `deploy-stoktok.yml:194-201` uses `[[ "$K" =~ ^[A-Za-z0-9._-]*$ ]]`. Bash ERE anchors `^`/`$` to the whole string, so newline, CR, `=`, `$`, `#`, space and quotes are all rejected. That covers line injection, compose `$` interpolation and inline-comment parsing. The checks run before `mktemp` (line 205), so a bad value leaves the old env file in place. The pattern uses the same literal form as the existing required checks, which already run on macOS bash 3.2.
- 🟢 **Empty value.** An unset secret is an empty string, the check allows it, and printf (line 207) writes `K=`. `packages/ai/src/env.ts` treats blank as "provider disabled". There is no `missing` line for either optional key. A whitespace-only value fails the run, which is fail-closed and documented in `docs/deploy.md:86`. Trade-off: a malformed *optional* key blocks the whole deploy, including web. This is Assumption 2 in the plan, which Ming should confirm.
- 🟢 **No value swap.** Env mappings `deploy-stoktok.yml:164-165` map each key to its own `STOKTOK_` secret. The printf format order and argument order match. `check-deploy-env.sh:132-137` now catches an argument swap (N2). An unquoted or `${}`-style argument also fails that check, so it errs on the safe side.
- 🟢 **No echo of values.** The error messages name only the secret, never the value. Nothing goes to `GITHUB_OUTPUT` or the step summary. The existing guards (no `set -x`, no heredoc) still apply. Because the charset forces single-line values, GitHub's log masking will work if a value is ever printed by accident.
- 🟢 **No real secrets in the repo.** I grepped for `sk-ant-`, `AIza…`, `eyJhbGci`, `sb_secret_` and `sk-proj-`. The only hits are the example `sk-ant-api03-Ab_c.d` / `AIzaSyX-1` strings in ticket notes and the plan, plus placeholders in the agent file. `.env.example:16-17` has empty values. Nothing uses `NEXT_PUBLIC_` (R3 holds).
- 🟡 **The charset pin checks for the text, not for the guard.** `check-deploy-env.sh:155` runs `grep -qF '[[ "$K" =~ ^[A-Za-z0-9._-]*$ ]]'` over the whole file. Two unsafe workflows would still pass:
  - `if [[ "$K" =~ … ]]; then …` (the `!` dropped, so it rejects only valid keys), or the same test with no `exit 1`.
  - The check placed after the printf, in another step, or in a comment.

  The four required keys' charset checks are not pinned at all (this predates the ticket).
- 🟡 **"The workflow writes nothing else" only covers the one printf line.** `check-deploy-env.sh:125-131` inspects only the line containing `printf 'SUPABASE_URL=`. A second writer such as `echo "X=$Y" >> "$tmp"` or another `printf … >> "$ENV_FILE"` would not be caught.
- 🟢 **(Older gap, slightly wider now.)** The mapping checks (`:81`, `:139`) search the whole file, not just the `secrets` step. So the AI secrets could also be mapped into `preflight` or `notify` (both write to the summary) and still pass. The `:250` awk check only blocks secrets in steps that run Mac-setup commands.
- 🟢 **Cross-name confusion (human error).** Nothing stops someone pasting a Supabase key into `STOKTOK_ANTHROPIC_API_KEY`. The impact is low: the value stays server-only and the provider call just fails.

### Recommendations
Both are follow-ups, not blockers. AC3 as written is met, and per R7 these belong on the follow-ups list rather than in this diff.
1. Pin the exact negated form and its position in `check-deploy-env.sh`. The line should match `^\s+if ! \[\[ "\$K" =~ \^\[A-Za-z0-9\._-\]\*\$ \]\]; then$`, the next lines should contain `exit 1`, and the line number should fall inside the `secrets` step and before `mktemp`. Do the same for the required keys' `+` patterns.
2. Fail if anything other than the one printf writes to `$tmp` or `$ENV_FILE` (for example, grep for `>> "$tmp"` or `> "$ENV_FILE"`).
3. Restrict `secrets.` mappings to the `secrets` step, using an awk block test like the one at `:250`.
4. Add these as N11–N13 to the planned `scripts/check-deploy-env.test.sh` follow-up.

### Risks
- An unsafe edit in the deployment repo could still pass the standing check (the two 🟡 findings). For now the reviewer reading the workflow is what prevents that.
- A malformed optional key blocks the whole deploy, including web (an availability cost).

### Open questions
- Should a malformed optional key fail the whole deploy, or only disable that provider? Currently it fails the deploy (plan Assumption 2).
- Service `web, worker` versus worker-only until STK-070 (the architect's least-privilege note): this is Ming's decision.

Files reviewed:
- /home/user/stoktok/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml
- /home/user/stoktok/scripts/check-deploy-env.sh
- /home/user/stoktok/.env.example
- /home/user/stoktok/docs/deploy.md

## Security re-review: STK-072, attempt 2 (`scripts/check-deploy-env.sh` only)

**Verdict: no 🔴 findings. Both attempt-1 🟡 findings are fixed for the threat that matters, which is an accidental unsafe edit.** Someone who sets out to fool the check can still get past it in a few ways, listed below. All are follow-ups (R7), not blockers.

I had no shell, so I traced both checks by hand against `deploy-stoktok.yml` and did not run anything.

### Fixes confirmed against the workflow
- 🟢 **Guard pin (`check-deploy-env.sh:139`, `:157-166`).**
  - The secrets step is cut out as lines 156–220 of the workflow, with comment lines removed.
  - For each optional key, the awk at `:159` finds the exact negated guard at `deploy-stoktok.yml:194` and `:198`. It then finds a line that is exactly `exit 1` two lines later (`:196`, `:200`), within the 4-line window, and checks that the guard comes before the first `mktemp` (`:205`).
  - `awk index()` matches plain text, so the `[ ] . * $` in the guard are not read as regex.
  - The old bypasses now fail the check: a dropped `!`, a missing `exit 1`, the guard placed after `mktemp` or in another step, or the guard in a full-line comment.
- 🟢 **Single writer (`:169-174`).** In the current secrets step only the printf at `:207` redirects to `$tmp`/`$ENV_FILE`, and it is excluded on purpose. `>> "$GITHUB_OUTPUT"`, `cmp`, `mv` and the error messages do not match the pattern. `echo X >> "$tmp"`, `>> $ENV_FILE`, `>"${tmp}"`, `1>`/`&>`, `exec 3>"$tmp"` and `tee` are all caught.
- 🟢 **No regressions.** The current workflow passes both new checks. Each new pipeline ends in `|| true`, so `set -euo pipefail` does not stop the script early. If the step boundaries cannot be found, `secrets_step` is empty and the guard check fails, so it fails closed. `\s` in the sed range at `:139` needs GNU sed, but the script already relied on that at `:98`.

### Easy bypasses that remain
- 🟡 **The printf can move ahead of the guards (`:161-162`, `:169`).** The guards are only checked against `mktemp`, never against the printf. The printf line is also skipped by the writer check, whatever its target. So `printf 'SUPABASE_URL=…' … > "$ENV_FILE"` placed before the guard lines passes. That writes unvalidated values directly and not atomically. Fix: require every guard line to come before the printf line, and require the printf line to end in exactly `> "$tmp"`.
- 🟡 **Anything on the same line as the printf is ignored (`:169`).** For example, `printf 'SUPABASE_URL=…' … > "$tmp"; echo "X=$Y" >> "$tmp"` passes. The key check at `:126` only reads `=%s` tokens, so it does not notice either. Fix: also require the printf line to end at the redirect (`> "$tmp"$`).
- 🟢 **The writer pattern has gaps (`:170`).**
  - These would get through: `>|"$tmp"`, a literal path or `"$dir/stoktok.env"` as the target, `cp`/`dd`/`sed -i` onto `$ENV_FILE`, and writes from other steps (only the secrets step is scanned).
  - Each needs a deliberate edit. A cheap way to harden it: grep the whole workflow for `stoktok.env` and for `$ENV_FILE` used with anything other than the known commands (`cmp`, `mv`, `stat`, `dirname`, `[[ ]]`).
- 🟢 **The guard match is loose (`:159-160`).**
  - The guard text is matched anywhere in the line, so it can also sit in an `echo '…'` or a trailing `# …` comment.
  - The `exit 1` only has to fall within the next 4 lines, not inside that `if`'s own body.
  - `if ! [[ … ]]; then :; else` also passes.
  - Fixing these means anchoring the match (`^[[:space:]]*if ! … then$`) and requiring the line after the guard to be the `::error::` echo, then `exit 1`, then `fi`.

### Attempt-1 follow-ups still open
1. **Partly done.** The optional-key guards are pinned. The required keys' guards are not: the `+` charset checks at `deploy-stoktok.yml:182`, `:190` and the `https://` checks at `:178`, `:186`. This gap predates the ticket.
2. **Done**, apart from the two 🟡 items above.
3. **Not done.** `secrets.` mappings are still matched across the whole workflow: `check-deploy-env.sh:81` and `:141` grep `$WF`, not `$secrets_step`. So the AI secrets could still be mapped into `preflight`/`notify`, which write to the step summary, and the check would pass. This is now a one-line change: grep `"$secrets_step"` at `:141`, and require that no other step contains `secrets.`.
4. **Not done.** There is no `scripts/check-deploy-env.test.sh` yet. The negative cases N11–N13, plus new cases for "printf before the guards" and "a writer on the same line as the printf", are still to write.

### Open questions (carried over from attempt 1)
- Should a malformed optional key fail the whole deploy, or only disable that provider (plan Assumption 2)?
- Should the AI keys go to `web, worker` or only to `worker` until STK-070? Both are Ming's decision.

Files:
- /home/user/stoktok/scripts/check-deploy-env.sh
- /home/user/stoktok/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml
- /home/user/stoktok/work/tickets/STK-072/security-review.md

## STK-072 security re-review, attempt 3 (`scripts/check-deploy-env.sh`)

**Verdict: no 🔴 findings. Both 🟡 findings from attempt 2 are closed.** The current workflow still passes every check. I don't have a shell, so I worked through each check by hand against `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` and ran nothing.

### Findings
- 🟢 **Closed: "printf can move ahead of the guards".**
  - The awk check at `check-deploy-env.sh:164-170` now requires each optional key's guard to come before both `mktemp` and the printf (`g < m && g < p`).
  - If the printf is not in the secrets step, `p` is 0 and the check fails. Since exactly one printf is allowed (`:128`), it can't hide in another step either.
  - Against the workflow: the guards at `deploy-stoktok.yml:194` and `:198` come before `mktemp` at `:205` and the printf at `:207`. Pass.
  - The printf can no longer target `$ENV_FILE` either. The pattern at `:127` requires the line to end in exactly ` > "$tmp"`.
- 🟢 **Closed: "anything on the printf line is ignored".**
  - Expanded, the pattern at `:127` is `^[[:space:]]+printf '[^']*'( "\$VAR")+ > "\$tmp"[[:space:]]*$`.
  - The format can't contain a `'`, the arguments can only be `"$NAME"`, and the line must end at the redirect.
  - So `; echo …`, `&&`, `>>`, `>|`, `> "$ENV_FILE"` and comment-prefixed lines all fail.
  - `grep -cF … -ne 1` (`:128`) fails closed if a second copy appears anywhere, even in a comment.
  - `deploy-stoktok.yml:207` matches the pattern.
- 🟢 **The guard is matched on the whole line** (`:165-166`). Leading and trailing spaces are trimmed, then the line is compared as plain text, not as a regex. Guard text inside an `echo`, a trailing `# …` comment or `; then :; else` on the same line no longer matches.
- 🟢 **`>|` is caught** (`:178`, `>(>|\|)?`). The non-printf lines of the current secrets step (`:168`, `:175-201`, `:209-219`) don't match, so there is no false positive.
- 🟢 **No regressions.** Every new pipeline is either inside an `if` condition or ends in `|| true`, so `set -euo pipefail` doesn't stop the script early. An empty `secrets_step` fails closed. The awk string comparison treats `[ ] . * $` literally.

### Remaining bypasses (all need a deliberate edit; 🟢, follow-ups per R7)
- **A command on the previous line can swallow the printf.** If the line before it ends in `\`, the printf becomes part of that command. For example, `cat other \` writes another file into `$tmp`, and `: \` leaves it empty. Neither the pattern check nor the writer check (`:177-178`) looks at the line before the printf. Fix: require the line before the printf to be exactly `trap 'rm -f "$tmp"' EXIT`.
- **The printf doesn't have to come after `mktemp`.** There is no `p > m` check, so `tmp="$ENV_FILE"` set earlier would make a non-atomic write possible. The guards still run first, so injection stays blocked.
- **The `exit 1` doesn't have to be in that `if`'s own body.** It only has to appear within the next 4 lines, so `then` / `:` / `else` / `exit 1` passes (`:167`).
- **The writer check only scans the secrets step and only `$tmp`/`$ENV_FILE`.** Not covered: writes from other steps, a literal `stoktok.env` path, and `cp`, `dd` or `sed -i` onto the env file (`:177-178`).

### Follow-ups still open from attempts 1 and 2
1. **Required-key guards are not pinned.** These are the `https://` checks at `deploy-stoktok.yml:178` and `:186` and the `+` charset checks at `:182` and `:190`. This gap predates the ticket.
2. **`secrets.` mappings are still matched across the whole workflow, not just the secrets step.** `check-deploy-env.sh:81` and `:147` grep `"$WF"` even though `secrets_step` is already computed at `:145`. So the AI keys could be mapped into `preflight` or `notify`, which write to the step summary, and the check would still pass.
3. **There is still no `scripts/check-deploy-env.test.sh`.** It should cover N11–N13, plus "printf before the guards", "a writer on the printf line", `>|`, and the line-continuation case.

### Open questions (Ming's decision, unchanged)
- Should a malformed optional key fail the whole deploy, or only turn that provider off?
- Should the AI keys go to `web, worker`, or only to `worker` until STK-070?

Files reviewed:
- /home/user/stoktok/scripts/check-deploy-env.sh
- /home/user/stoktok/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml
- /home/user/stoktok/work/tickets/STK-072/security-review.md
