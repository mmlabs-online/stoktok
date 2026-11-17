# STK-084 security review

## Attempt 1

**Security review, STK-084 slice A1. Verdict: no 🔴 findings and no blocker. There are four 🟡 hardening items.**

Caveat: I could not run `git diff` because I only have Read, Grep and Glob. I read every file the impl-log lists as changed in its current state on HEAD.

### Findings

**/readyz: public route, auth bypass and information leak**
- No leak and no auth bypass. `/home/user/stoktok/apps/web/app/readyz/route.ts:17-21` returns only `{status:'ok'}` or `{status:'unavailable'}` with `cache-control: no-store`.
- The log line at `:20` carries only an enumerated code: a `DataErrorCode`, `timeout` or `config`. It never includes the error message, so host and password stay out of the logs.
- `pingDb` (`/home/user/stoktok/packages/db/src/repos/health.ts:7`) runs a fixed `select 1` through `q()`. No input from the request reaches the database.
- `proxy.ts:7` adds `/readyz` to `PUBLIC_PATHS`. Because the prefix match also covers `/readyz/*`, a future `readyz/<x>/route.ts` would skip the proxy gate. However, `entrypoints.test.ts:15` exempts only the exact file `readyz/route.ts`, so such a route would still have to call `requireUser()`. That is acceptable under R6.
- 🟡1 Unauthenticated pool use: `route.ts:16` and `config.ts:15`. Every `/readyz` hit takes one of the web pool's 5 connections. A flood from an anonymous caller could make Ming's own pages wait for a connection (up to `connectionTimeoutMillis` 5 s). On failure it also writes one log line per request; json-file rotation caps the disk use. The exposure is low today because Cloudflare Access is in front and the compose health check calls `127.0.0.1`. Options:
  - keep `/readyz` out of any Cloudflare Access bypass rule and say so in `docs/deploy.md`; or
  - memoise the ping result for about 2–5 s in the route.
  Rule: R6 (public-list exception).

**R3: `STOKTOK_DATABASE_URL` read only in `client.ts`**
- Holds. The only runtime reader is `packages/db/src/pg/client.ts:10,33`. `migrate.ts` uses the `databaseUrlFromEnv` accessor.
- Other mentions are guards, docs, tests, `.env.example` (no value) and the smoke URLs in `check-image.sh`, which point at port 9 and are not real credentials.
- The client error messages name the env var, never its value (`client.ts:45`). The new permanent `error` listener (`client.ts:90`) logs `code` only, which is also good.

**Secrets and the master key in files, logs or argv**
- No literal secret or master key in any changed file. I grepped for a 43-character base64 string ending in `=` and for `postgres://user:pw@` URLs.
- The master key goes only from a step env mapping to its format guard to the single `printf` builtin (`deploy-stoktok.yml:174,212-216,229`). It never appears in argv or an echo. `check-deploy-env.sh:224-235` pins this.
- `release.yml:156` changes only the PR body text.

**Deploy workflow: password file and env-file mode**
- Env file: `umask 077`, a `mktemp` file in a mode-700 directory, `chmod 600`, atomic `mv`, then an owner+mode check (`deploy-stoktok.yml:176,224-237`). Correct.
- The password is read with the `read` builtin and goes only into the `printf`. The URL is never on argv.
- 🟡2 The format check and the value actually used are not the same thing (`deploy-stoktok.yml:218,222`). `grep -Eq '^[A-Za-z0-9_-]{16,}$'` passes if *any* line of the file matches, but `read -r pw` takes the *first* line. A file whose first line is blank or malformed would pass the check and produce a broken URL. A malformed first line could contain `@`, `/` or `:` and change the meaning of the URL; it still cannot add a new env line. Fix: after `read -r pw`, check the value itself, for example `[[ "$pw" =~ ^[A-Za-z0-9_-]{16,}$ ]] || { echo "::error::..."; exit 1; }`. Then update the literal pinned in `check-deploy-env.sh:242`.
- 🟡3 The password is not masked in logs. It comes from a committed file, not a GitHub secret, so the runner does not mask it. Nothing prints it today:
  - `config` runs with `--quiet` or `--services`;
  - the migrate output comes from `migrate.ts:131-133`, which prints only `pg.DatabaseError` and guard messages;
  - `compose up` and `compose run` do not echo env values.

  Defense in depth: add `echo "::add-mask::$pw"` right after `read`. GitHub consumes this workflow command and does not log it, but it does conflict with the "no echo" style, so it needs a decision.
- 🟡4 Gap in the `config --quiet` guard (`check-deploy-env.sh:109`). `grep -F '" config'` only matches `"${compose[@]}" config`. A future `"${compose[@]}" --profile x config` without `--quiet` would not be caught, and an unquiet `config` prints the resolved env, including the DB URL and keys. Line 250 (`--services`) is safe today. Fix: match `[[:space:]]config([[:space:]]|$)` on lines containing `compose`, and allow only `--quiet` or `--services`.
- Order of steps: `pull`, `backup`, `migrate` and `deploy` use an implicit `success()`, so a failed `secrets` step stops everything. `deploy` waits for a successful `migrate` when there is a migrate service (`:291`). The pre-migration backup fails closed (`:262-265`). This is correct.
- Accepted by the shared-Postgres standard, not a finding: the DB password is committed in the deployment repo. Anyone with read access to `mmlabs-online/deployment`, and the self-hosted runner checkout, holds the DB credential. That repo must stay private.

**Error logs**
- These log a code only and never a message: `client.ts:57,83,90,102`, `route.ts:20`. The idle-in-transaction listener added outside the plan (`client.ts:90`) follows the same pattern.
- `migrate.ts:177` (the "ahead" line) prints version names only.

### Recommendations
1. 🟡2: check `$pw` after `read`. Rules R3 and Conventions/secrets; AC 1 (deploy writes the URL from the password file).
2. 🟡4: tighten the `config` guard in `check-deploy-env.sh`. Rule R3.
3. 🟡1: write down that `/readyz` must not get an Access bypass, or memoise the result. Rule R6.
4. 🟡3: optionally `::add-mask::` the password. This is Ming's or the orchestrator's call.

### Risks
- Once STK-094 moves the health check to `/readyz`, a slow database makes the deploy health check fail, which triggers a restore. That is intended, but it ties availability to the database.
- When the database is ahead of the image, `migrate` exits 0 with only a warning, so the app is still replaced (`deploy-stoktok.yml:284-287`). This is the open question from STK-089. I see no security impact.

### Open questions
- Does the Cloudflare Access application cover the whole stoktok hostname, with no bypass for `/healthz` or `/readyz`?
- Should the password be masked with `::add-mask::`, given the "no echo" convention in the secrets step?


## Attempt 2

**Verdict: 🟡1, 🟡2 and 🟡4 are closed. No new 🔴 findings. One new low 🟡 (5) and two notes.** 🟡3 (`::add-mask::`) stays open because Ming declined it; my attempt-1 analysis still holds and nothing prints the password today.

I only had Read, Grep and Glob, so I read the current files rather than a diff, and I did not run the guard script or the tests.

### Re-check of the attempt-1 findings

**🟡2: closed.** `/home/user/stoktok/deploy/deployment-repo/.github/workflows/deploy-stoktok.yml:217-225`
- The regex is now checked against the same value that goes into the URL. `pw=""` is set, then `read -r pw < "$pwfile" || true`, then `[[ "$pw" =~ ^[A-Za-z0-9_-]{16,}$ ]]`, which fails with `exit 1`.
- **Injection into the URL is not possible.**
  - The pattern is anchored at both ends, and its character set has no `@ : / % ? #`, no whitespace and no newline (`read` stops at the first newline).
  - So the value cannot change the userinfo, host or path of `postgres://$DB_APP:$pw@postgres:5432/$DB_APP`, and it cannot add an env line.
  - A CRLF file leaves a trailing `\r` in `$pw`, so the check fails safely.
- **Bad files fail closed.**
  - A missing file makes the redirect fail; `|| true` absorbs that, `pw` stays empty and the regex rejects it.
  - A blank first line also leaves `pw` empty and is rejected.
  - A file with no trailing newline still fills `pw`, and `|| true` stops `bash -e` from aborting.
- The `::error::` text names only the file path and never the value.
- The regex is kept in a variable, which avoids bash 3.2 quirks.

**🟡4: closed.** `/home/user/stoktok/scripts/check-deploy-env.sh:109`
- The guard now matches any `"${compose[@]}"` or `docker compose` line with ` config` followed by whitespace or end of line, and it requires `--quiet` or `--services` on that line.
- It catches the case I raised in attempt 1 (`--profile x config`). The impl-log mutation proofs cover it, with two `--profile` flags before `config`.
- Current lines `:250` (`--quiet`) and `:252` (`--services`) pass. The `backup` line `:264` does not match.
- What the guard still cannot catch (not a finding; a line-based grep cannot see these):
  - a compose array under another name, such as `dc=(...)`;
  - `docker-compose` with a hyphen;
  - `config` placed after a `\` line continuation;
  - `--quiet` that belongs to a different command on the same line.
- A short comment on `:109` saying the guard assumes the `compose` array convention would help the next editor.

**🟡1: closed.** `/home/user/stoktok/apps/web/app/readyz/route.ts:13,32-35` and `/home/user/stoktok/docs/deploy.md:99`
- **A failed check is not cached forever.**
  - `check()` cannot reject: `getDb()`, `pingDb()` and the timeout are all inside the `try`, and the `catch` returns `{ok:false, code}`.
  - So the shared promise always resolves, and the entry is replaced once `now - at >= 3000`. A failure is served for at most about 3 s.
  - Because `at` is taken when the check starts, and the 2 s timeout is shorter than the 3 s cache, a hanging ping cannot pin the cache either.
- **No error details leak.**
  - The cached value holds only `ok` and an enumerated `code` (`DataError.code`, `timeout` or `config`). It never holds a message.
  - The body is still `{status}` only, with `no-store`.
  - The tests at `/home/user/stoktok/apps/web/test/readyz.test.ts:39-57` still check for the SENTINEL strings.
- **Load is capped.** Each web process now does at most one DB round trip and at most one `readyz_db_unavailable` log line every 3 s, however many anonymous calls arrive. Concurrent callers share the in-flight promise; the test at `:76-85` covers this.
- `docs/deploy.md:99` now states that `/readyz` must never get an Access bypass. That answers my attempt-1 open question in the runbook. Step 10 at `:120` already says "no bypass rules".

### New findings

- 🟡5 (low): the password guard is pinned more weakly than the master-key guard. `/home/user/stoktok/scripts/check-deploy-env.sh:240-252`
  - The pinned-literal loop only checks that each line exists before `mktemp`. It does not check that the `if ! [[ "$pw" =~ $re_pw ]]` line is followed by `exit 1`, or that it comes before the `STOKTOK_DATABASE_URL=` line.
  - So a future edit that drops `exit 1`, or moves the URL line above the check, would still pass the guard. That would bring back the exact 🟡2 gap.
  - The master key is protected better: an awk check at `:224-231` requires `exit 1` within 4 lines.
  - Fix: reuse that awk pattern for `re_pw`, or add one check that the guard's line number is less than the URL line's and that `exit 1` follows within 4 lines.
  - Rule: R3 and Conventions/secrets.

### Notes (not findings)

- **Abandoned pings can still hold connections.** `route.ts:21`: `Promise.race` does not cancel the ping. After the 2 s timeout, the query can keep holding a web-pool connection until `statementTimeoutMs` (15 s, `/home/user/stoktok/packages/db/src/pg/config.ts:15`). If the DB hangs, a new ping every 3 s can tie up about 5 connections, which is the whole pool.
  - This was already true in attempt 1, and the memo lowers the rate. It only happens when the DB is already unhealthy.
  - Optional fix: run the ping with a short per-query `statement_timeout`, for example `set local` in a transaction, or a dedicated client with `query_timeout`.
- **Clock jumps can stretch the cache.** `route.ts:34` uses `Date.now()`. If the wall clock steps backwards, the current result (possibly a 503) is served until the clock catches up. Optional fix: use `performance.now()`.
- **Test gap.** No test shows that a *failed* result is cached and then retried after 3 s. Optional: add one so the "not cached forever" behaviour is pinned.

### Recommendations
1. 🟡5: pin the order of the password guard and its `exit 1` in `check-deploy-env.sh`, like the master-key awk check. Rule R3; AC 1.
2. Optional: a test for failure memoisation and expiry; `performance.now()`; a short timeout on the ping query.

### Risks
- Unchanged from attempt 1: tying `/readyz` to the DB health check (STK-094); "DB ahead" exits 0; the committed password file means the deployment repo must stay private.
- 🟡3 is still open by decision: the password has no runner masking. It relies on no step ever printing the resolved env, which the 🟡4 guard now enforces better.

### Open questions
- None new.
