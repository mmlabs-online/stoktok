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
