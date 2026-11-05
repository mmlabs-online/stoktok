# STK-049 security review, attempt 1

## Security review: STK-049 slice 1, attempt 1

**Verdict: no blocking (🔴) findings.** There are 4 🟡 hardening items and the rest is 🟢. Two notes on method. I couldn't run git or any commands (the environment says the folder is not a git repo, and I had read-only tools only), so I reviewed the files named in the brief directly rather than a `HEAD~1..HEAD` diff. Nothing was executed. "Checks pass" below means the checks are written correctly, not that I saw them run.

### Findings

**RLS and grants: 🟢 correct**
- `supabase/migrations/20261105000200_prices_intraday.sql:18-20`:
  - RLS is enabled with no policies, so access is deny-by-default.
  - `revoke all … from public, anon, authenticated`, then only `service_role` gets S/I/U/D.
  - There is no sequence (the PK is natural), so no sequence grant is needed.
  - Line 2 explains why the grants are in this file: the grants loop in 20261023000200 only covers tables that existed then. That is correct.
- `scripts/db-check/checks.sql` covers the new table through the existing generic checks, which all loop over `pg_tables`:
  - `rls_enabled_all_tables` (:155)
  - `no_policies` (:163)
  - `no_grants_anon_authenticated_public` (:170)
  - `anon_denied` / `authenticated_denied` select+insert (:181)
- New checks for this table:
  - `prices_intraday` added to `tables_exist` (:34)
  - integer price and bigint volume (:56, :67)
  - R4 columns (:98-100)
  - service_role upsert round-trip (:262-275)
  - bad-row cases (:281)
- Constraints: symbol regex `^[A-Z0-9]{1,20}$`, `price > 0` as integer (R2), `volume >= 0`, non-empty `source`, `fetched_at not null` (R4). Good.

**Rollback: 🟢**
- `supabase/rollback/20261105000200_prices_intraday.down.sql:1` is `drop table if exists`. It is idempotent, nothing depends on the table, and the data loss is expected for a cache table.

**R3: can `@stoktok/sources` reach a client bundle?**
- 🟢 Not today. Only `apps/worker` depends on it (pnpm-lock.yaml:90). `apps/web` has no dependency or `transpilePackages` entry for it.
- 🟢 The package holds no secrets: no `process.env`, no keys. Its config is public URLs and a User-Agent.
- 🟢 The worker image is safe. `.dockerignore` excludes `.env*` and `work/`, and the runtime stage copies only `dist`, `node_modules` and `package.json` (apps/worker/Dockerfile:25-27).
- 🟡 **The guard is weaker than the one for `@stoktok/db`.** `packages/db/src/r3-guard.test.ts:41-46` only catches a `'use client'` file importing `@stoktok/sources` *directly*. It misses a client component that imports a shared non-client module which then imports sources. For `@stoktok/db`, the guard also pins web importers to one file, `apps/web/server/db.ts`, which starts with `import 'server-only'` (:48-53). Sources has no equivalent.
  - The risk is low because there are no secrets to leak. The real harm would be a browser calling VietCap directly, which breaks the ADR 0006 throttle and politeness model.
  - Recommendation for slice 2 (plan AC1/1b, R3): add an `apps/web/server/sources.ts` that starts with `import 'server-only'`, and extend the importer-pinning test to `@stoktok/sources`.

**Outbound request hygiene: 🟢, with two 🟡**
- 🟢 `packages/sources/src/http.ts:38-42` sends only `User-Agent`, `Accept` and `Content-Type` (POST only). Callers cannot add headers. There are no cookies, auth, Referer/Origin spoofing or browser-like UA.
- 🟢 The UA is honest and states the rate (`config.ts:21`).
- 🟢 403 is not retried: `retryable` is only 429 or ≥500 (`http.ts:52`). The adapter turns a 403 into a terminal "no bypass" error (`vci-intraday.ts:76-78`).
- 🟢 Intraday config uses `maxAttempts: 1` and a 5 s timeout (`config.ts:16-18`).
- 🟢 Error messages carry only the status or the error name. No URL, body or secret goes to logs.
- 🟡 `http.ts:36` uses fetch's default `redirect: 'follow'`, so a redirect could send the request to another host. No secrets are sent, so the impact is small. Consider `redirect: 'error'` for a fixed-host API (outbound hygiene).
- 🟡 `http.ts:47` reads the whole body with `res.json()` and has no size cap. That is acceptable for a trusted fixed host. Consider a size cap before slice 2 puts this on the web request path.

**Parsing untrusted JSON: 🟢**
- `vci-intraday.ts:82-97`:
  - The top level must be an array, or an object with an array `data`.
  - Each item must be an object whose `symbol` is in the requested set; otherwise the whole chunk is rejected.
  - `t`, `c` and `v` must all be arrays of equal length.
  - Duplicate symbols are rejected, and missing symbols are reported as `no_data`.
- `num()` (:32-35) only converts plain digit strings.
- Core (`packages/core/src/market/intraday.ts:109-133`) validates each field:
  - `t` must be a safe non-negative integer.
  - The price goes through `toVnd`, which requires a safe integer for unit VND (`daily-bar.ts:33`), so fractional strings like `"1.5"` are rejected. Then come the band, step and jump checks.
  - Volume must be a safe integer, and so must the running sum.
- Integer VND (R2) holds.
- Prototype pollution: no objects are built from keys the source controls. `ctx.lastCloses?.[symbol]` only looks up symbols from the caller's upper-cased requested set, so `__proto__` and `constructor` cannot match. The repo's `out[row.symbol]` keys come from DB rows that pass the regex constraint.

**Shell script: 🟢, with two 🟡** (`work/tickets/STK-049/record-vci-intraday-samples.sh`)
- 🟢 Quoting is correct throughout (`"$2"`, `"$BASE$1"`, `"$OUT/$3"`).
- 🟢 The bodies are built from constants. There are no secrets and no `.env` reads. Headers are the honest UA, Accept and Content-Type only.
- 🟢 The `.tmp` file is cleaned up on both paths.
- 🟢 A 403 runs `exit 1` from a function called at top level (not inside a subshell), so it really stops the script (:19). The 30 s spacing matches the stated UA rate.
- 🟡 Line 4 is `set -u` only, not `set -euo pipefail` as the brief asked.
  - Adding `-e` as-is would break the "continue after a non-403 failure" behaviour unless each `post` call gets `|| true` or a counter.
  - The real gap: the script always exits 0 and prints "Done" even if both gap-chart calls failed (for example a network failure gives code `000`).
  - Fix: track failures and `exit 1` at the end if any gap-chart call failed, or use `set -euo pipefail` with an explicit `|| rc=1` on each call. This supports go/no-go checklist item 1 in ADR 0006.
- 🟡 curl has no `--max-time` or `--connect-timeout`, so it can hang. Suggest `--max-time 15` (outbound hygiene).
- 🟢 A 200 HTML challenge page would be saved as `gapchart-*.json`. That is safe, because `JSON.parse` in `vci-intraday.samples.test.ts:12` would fail loudly.
- 🟢 Paths are relative to the current directory ("run from repo root"). Running it elsewhere only creates stray folders. Optionally `cd "$(dirname "$0")/../../.."`.
- 🟢 The README records `$(hostname)` of the home server and gets committed. The plan asks for this, and it is a minor information leak if the repo ever goes public.

### Recommendations
1. Slice 2, before web imports sources (R3, AC1): add a `server-only` wrapper module in web and pin web importers of `@stoktok/sources` in `r3-guard.test.ts`, mirroring the `@stoktok/db` rule.
2. Script (go/no-go item 1): return a non-zero exit when any gap-chart call fails, and add `--max-time`.
3. Optional before slice 2: set `redirect: 'error'` and a response size cap in `http.ts`.

### Risks
- VietCap terms and rate limits are still UNVERIFIED (ADR 0006). Slice 2 must enforce the 30 s throttle on the server, never only on the client.
- There is no prune job yet for `prices_intraday`, so storage grows without bound. This is tracked as a follow-up and does not affect access control.

### Open questions
- Is the repo private? This decides whether committing the hostname and live samples is fine.

---

# STK-049 security review, attempt 2

## Security re-review: STK-049 slice 1, attempt 2

**Verdict: no 🔴. All four 🟡 items from attempt 1 are fixed.** Two of them were for slice 2 and are now done early. Nothing new is above 🟢. As before, I only read files: no git diff and no test runs. The R3 server-only wrapper for `@stoktok/sources` (attempt-1 recommendation 1) is still owed in slice 2. It was out of scope for this attempt.

### Attempt-1 🟡 items
1. **Redirects: resolved.** `packages/sources/src/http.ts:47` sets `redirect: 'error'`, and `http.test.ts:61-69` checks it. When a redirect happens, fetch throws a TypeError. The code maps that to `network error: TypeError`, so no URL or body ends up in the message.
2. **Body size cap: resolved, and it can't be bypassed.**
   - `http.ts:77-78` rejects early when `content-length` is over the cap. If the header is missing, `Number(null)` is 0. If it's junk, the result is NaN. Either way the code falls through to the stream check, so leaving out the header or using chunked encoding doesn't skip it.
   - `http.ts:84-97` counts the actual bytes read from `res.body`. For gzip or brotli responses, undici's stream gives decompressed bytes, so the count also guards against a decompression bomb. A server that sends a small compressed `content-length` still hits the stream count.
   - Memory is limited to about `max` plus one chunk.
   - Going over the cap is non-retryable (`:76`), and the error message is a fixed string.
   - `http.test.ts:70-76` tests the stream path. A `Response` built from a string has no content-length, so that test does exercise it. `:77-83` tests the header check and the exactly-at-cap case.
3. **Script exit code: resolved.** `record-vci-intraday-samples.sh:5,21,27,29,33`: `FAILED` is set whenever a gap-chart call fails, and the script exits 1 at the end. A 403 still `exit`s right away (`:20`). `post … || FAILED=1` doesn't run in a subshell, so that exit really stops the script. A network failure gives `000`, which counts as a failure. The board call uses `|| true`, which is fine because it's info only, and a 403 there still stops the script.
4. **curl timeouts: resolved.** `:12` uses `--connect-timeout 10 --max-time 15`.

### Requested checks
- **Stream cancelled on overflow: yes.** `http.ts:93` runs `await reader.cancel()` before throwing.
- **JSON.parse errors: mapped safely.** `http.ts:58-62` turns any parse error into the fixed message `'response is not valid JSON'`, non-retryable, with the status. It never includes the body or `e.message`, so an HTML challenge page can't leak into logs. Body-read errors (`:54-56`) also become a fixed message. The outer catch (`:66-67`) passes SourceErrors through without wrapping them again.

### New findings (all 🟢, optional)
- 🟢 `http.ts:78`: when the header check rejects, it throws without cancelling `res.body`. The socket stays open until garbage collection. Fix: `await res.body?.cancel().catch(() => {})` before throwing. The same goes for the non-ok branch (`:64-65`), which never consumes or cancels the body, and that one also runs on retries.
- 🟢 `http.ts:93`: if `reader.cancel()` rejects, the error isn't a SourceError. The catch at `:54-56` then reports it as `'failed to read response body'` with retryable **true**, so an oversized body could be retried. That's unlikely in practice. Fix: `await reader.cancel().catch(() => {})`.
- 🟢 `http.ts:79-83`: when `res.body` is null, the code calls `res.text()` with no limit and checks the size afterwards. Real fetch only has a null body for empty responses (204/304 and similar), so this is safe. But the worker mocks (`apps/worker/src/sources/vci.test.ts:8-9` and others) only supply `text()`, so worker tests never reach the stream path. Coverage of that path lives only in `packages/sources/src/http.test.ts`, which is acceptable.
- 🟢 A redirect is treated as retryable (it goes through the network-error path). Worker sources with `maxAttempts: 3` will try a redirecting host 3 times. Intraday uses `maxAttempts: 1`, so it isn't affected. Optionally, map redirect errors to non-retryable.
- 🟢 Test gaps: nothing tests the invalid-JSON mapping (a 200 with a non-JSON body should give non-retryable `'response is not valid JSON'`). Nothing confirms `cancel()` is called when the cap is exceeded. Worth adding for R8.

### Risks
- The default 5 MiB cap (`http.ts:14`) applies to every worker source (TCBS, VCI, VCI-IQ financials). A real response bigger than that would fail with a non-retryable error. That's unlikely for these payloads, but an over-cap error in the logs should be read as "the cap may be too low", not as an attack.
- From attempt 1, still open: VietCap terms and rate limits are unverified. Slice 2 must enforce the throttle on the server, plus the R3 server-only wrapper and the importer-pinning test.

### Open questions
- Is the repo private? This still decides whether it's OK to commit `$(hostname)` in the live-samples README (`record-vci-intraday-samples.sh:26`).
