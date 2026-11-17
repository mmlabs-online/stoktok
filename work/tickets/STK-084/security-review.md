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
