## Security review — STK-005 attempt 1 (EOD price sync)

**Verdict: no 🔴 blockers.** The service key stays out of logs, error output, the JSON summary and the HTTP source. I found three 🟡 items, all small. The reviewer can treat them as fixes for this ticket or as follow-ups. This review is read-only: I ran no checks and did no rescan, so it is code-visible coverage only.

### Findings

**Service role key (R3): clean**
- `packages/db/src/client.ts:6-13` reads the key from the env object passed in. Its error messages name the missing variable, never its value.
- `apps/worker/src/cli.ts:29-33`: the Supabase client and `TcbsPriceSource` are built separately, and the source never receives `db` or `env`.
- `cli.ts:50` prints only `e.message`. `DataError` messages (`packages/db/src/errors.ts:10-21`) carry table, op and pg code only.
- `eod-sync.ts:120-136`: the summary holds no env or connection fields.
- `.env.example:17` has an empty value. No JWT- or key-shaped strings appear in fixtures, the README or the ADR.

**Outbound requests: mostly good**
- The host is fixed (`config.ts:17`). The URL is built with `URLSearchParams` (`tcbs.ts:33-40`), so a symbol string can't inject into the path or query. Symbols are also normalised to `^[A-Z0-9]{3,10}$` first (`packages/core/src/symbol.ts:4`, `eod-sync.ts:65-69`).
- Only `User-Agent` and `Accept` headers are sent (`http.ts:23`). The User-Agent is honest and descriptive (`config.ts:18`).
- Timeouts use `AbortSignal.timeout`, which also covers reading the body. Retries are bounded (3 attempts, 1 s then 2 s backoff), only on network errors, 429 and 5xx. The run stops after 5 consecutive failures.
- 🟡 `http.ts:22`: `fetch` follows redirects by default. A 3xx response could send the worker to any host, and the JSON from there would go through the normal validation. Add `redirect: 'error'` (or `'manual'`) to keep it on the fixed host. Low impact: no credentials are sent.
- 💭 `http.ts:28`: there is no limit on response size, and `data.length` is not capped (`tcbs.ts:53`). Fine for a personal tool, but a cap is cheap.
- 💭 `http.ts:33-34`: the body of a non-OK response is never read or cancelled. Harmless at this request volume.
- 💭 `tcbs.ts:19`: the `baseUrl`/`userAgent` overrides are only used by tests. `cli.ts` doesn't pass them, which is fine. Just keep them out of env parsing later.

**Validation of the untrusted response: solid**
- `packages/core/src/market/daily-bar.ts:31-72` checks:
  - the `typeof` of each value
  - finite, safe-integer prices
  - the thousand-VND conversion (with an epsilon check)
  - volume is a non-negative safe integer
  - OHLC ordering
  - min/max price band, price step and close-jump ratio
- The stored symbol is the one we asked for, not the one in the response (`daily-bar.ts:72`), so a response can't write rows for other tickers. Dates outside the requested window are dropped (`tcbs.ts:60`).
- Bounds fit the DB: max 10,000,000 VND is under the int4 limit, and volume is bigint with a `>= 0` check (`supabase/migrations/20261023000100_v1_tables.sql:82-91`).
- 💭 Integrity risk (accepted in the ADR): every run overwrites the last 20 trading days on `(symbol, trade_date)` (`prices-daily.ts:46`). A changed or poisoned TCBS response inside the sanity bounds could quietly rewrite stored history. Worth adding to the follow-ups: only overwrite a row when the source matches, or log when values change.

**Env loading**
- `.gitignore:9-10` covers `.env.local` and `.env.*.local` in every directory, including `apps/worker/.env.local`.
- 💭 `apps/worker/package.json:13`: the `.env.local` path is relative to the working directory. That works under `pnpm --filter`, which runs scripts in `apps/worker`. `--env-file-if-exists` needs Node ≥ 22.9, but the root `engines` field says `>=22`. On older Node it fails loudly rather than unsafely; suggest tightening `engines` to `>=22.9`.
- `start:job` (`dist/cli.js`) loads no env file, so the container must inject env. That's correct.

**No-network test guard**
- 🟡 `apps/worker/test/no-network.ts:4` only replaces global `fetch`. It can be bypassed by accident:
  - a test calling `vi.unstubAllGlobals()` brings back real `fetch` for the rest of that file;
  - `node:http`/`node:https`, `undici` imports and `net` are not blocked;
  - `packages/db` tests have no guard at all, though they use mocked clients today.

  Hardening (any one helps):
  - make the stub permanent with `Object.defineProperty(globalThis, 'fetch', { value: …, writable: false, configurable: false })`;
  - also stub `http.request` and `https.request` (and `.get`);
  - add the same setup file to `packages/db`.

  `tcbs.test.ts:61` checks the guard is in place, which is good.

**Dependencies**
- 🟡 `apps/worker/package.json:19-25` uses caret ranges, but `pnpm-lock.yaml:73-93` locks exact versions. That's sane as long as CI installs with `pnpm install --frozen-lockfile`; please confirm it does. The worker's only new runtime dependency is `@supabase/supabase-js` (already used in the repo). `tsx`, `tsup` and `vitest` are dev-only. Running the `job` script needs the dev dependencies (`--import tsx`); production uses `dist/cli.js`.

**Docs and fixtures**
- `docs/adr/0001-eod-price-source.md` and `apps/worker/README.md` contain no secrets. The README tells the user to keep the key in the git-ignored `.env.local` and notes R3.
- Fixtures are labelled SYNTHETIC (`test/fixtures/tcbs/README.md:3`). Its curl example uses a different User-Agent (`stoktok/0.1 (manual check)`), which is still honest.

### Recommendations
1. Add `redirect: 'error'` in `http.ts:22` (Ming's "fixed host" constraint).
2. Make the no-network guard non-removable, extend it to `http`/`https`, and add it to `packages/db` (AC5).
3. Confirm CI uses `--frozen-lockfile`.
4. Follow-ups list (R7): a response-size cap, `engines >=22.9`, and a policy for when the source overwrites stored history.

### Risks
- TCBS is unlicensed for automated use and could block or change without notice. Ming has accepted this in the ADR.
- Wrong units or a changed response shape are caught by the plausibility guards, not stored.
- R6 is suspended, but this is a CLI job with no exposed endpoint, so this ticket adds no auth surface.

### Open questions
- Does the CI workflow install with `pnpm install --frozen-lockfile`?
- Should a re-sync be allowed to overwrite rows that are already stored with different values, or only fill missing rows?

Files reviewed (all under `/home/user/stoktok`):
- `apps/worker/src/cli.ts`, `config.ts`, `store.ts`, `sources/http.ts`, `sources/tcbs.ts`, `jobs/eod-sync.ts`
- `apps/worker/package.json`, `vitest.config.ts`, `test/no-network.ts`, `test/fixtures/tcbs/*`, `README.md`
- `packages/db/src/holdings.ts`, `repos/prices-daily.ts`, `client.ts`, `errors.ts`
- `packages/core/src/market/daily-bar.ts`, `market/config.ts`, `symbol.ts`
- `docs/adr/0001-eod-price-source.md`, `.gitignore`, `.env.example`, `pnpm-lock.yaml`
