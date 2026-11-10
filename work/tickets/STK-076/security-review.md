# STK-076 security review

## STK-076 security review, attempt 1

**Verdict: no 🔴 and no 🟡 findings. The change is safe to pass on security grounds.**

I couldn't run `git diff` (no shell), so I read the listed files directly, plus the repo layer `packages/db/src/repos/ai-keys.ts`, `apps/web/server/auth/*` and `next.config.ts`.

### Findings

**R6: requireUser before any DB access** — 🟢
- In `apps/web/app/(app)/settings/actions.ts:25` and `:32`, `await requireUser()` runs before `getDb()` in both the save and delete actions. It also runs first in `saveSettingsAction` at `:15`.
- `page.tsx:15` calls `requireUser()` before any of its reads.
- `requireUser` fails closed and redirects on any failure (`server/auth/require-user.ts:32-36`).

**Key never returned (action state, RSC payload, HTML, logs, error text)** — 🟢
- On success the action state is `{ok, provider, last4, savedAt}` (`server/ai-keys.ts:28`). On error it is `{ok, provider, code}`, built from fixed codes only.
- The `log()` helper (`server/ai-keys.ts:15-17`) writes only `{event, provider, code}`.
- The repo layer never uses `unwrap()` and throws fixed text plus the pg code (`packages/db/src/repos/ai-keys.ts:20-24`), so PostgREST messages that might echo `p_key` are dropped.
- UI messages are fixed strings with no input interpolated (`packages/core/src/ai/key-rows.ts:44-63`).
- The card receives only `last4`, `savedOn` and booleans.
- The tests check that the sentinel appears in no result and no console output, including rpc errors whose `message`/`details` contain the key (`server/ai-keys.test.ts:97-113`).
- The input is `type="password"`, password managers are suppressed, and the form resets after every result (`ai-keys-card.tsx:56-59, 117-133`).

**No rpc `get: true`** — 🟢 `saveAiKey` and `deleteAiKey` call `db.rpc(name, args)` with no options (`repos/ai-keys.ts:34, 47`). That means a POST body, so the key never ends up in a URL or access log.

**Provider allow-listing** — 🟢 The provider is checked against `AI_PROVIDERS` at the action layer (`server/ai-keys.ts:9-12`) and again in the repo (`repos/ai-keys.ts:26-28`). A `File`, a missing value or an unknown string gets `AI_KEY_PROVIDER` before any rpc call, and this is tested.

**Format validation without trimming** — 🟢 `server/ai-keys.ts:23` has no trim. A `File` value becomes `''`, which is rejected as `AI_KEY_EMPTY`. The repo re-validates the format (`repos/ai-keys.ts:33`). Tests cover leading/trailing whitespace, length 19/257 and non-ASCII.

**Env presence leaks only booleans** — 🟢 `server/ai.ts:29-31` returns `!!value` per provider, and `ai.test.ts:65-72` checks this with a sentinel.

**Page never calls the decrypting path** — 🟢
- `readAiKeyRows` uses `listAiKeyMeta`, which selects only `provider, last4, updated_at` from the table. A test checks that `rpc` is never called (`ai-keys.test.ts:124-133`).
- The dynamic `import('./ai')` (`server/ai-keys.ts:49`) does load a module that references `readAiKeySecrets`, but only `aiEnvPresence` is called. That code stays on the server.
- `r3-guard.test.ts:133-143` enforces this for the actions, page, card and `ai-keys.ts`.

**Client component imports no server modules** — 🟢 with one note
- The card is `'use client'` and imports only `@stoktok/core`, `lucide-react`, `react` and `../transactions/form-fields`.
- `form-fields.tsx:2` has `import type { FormMessage } from '../../server/transactions/handlers'`. That import is type-only and removed at compile time, so it is harmless. However, the r3-guard check only scans the card file, not what it imports.
- Optional hardening: move `FormMessage` into `packages/core` or the components folder, so no future change can turn that line into a real server import.

**CSRF and forged action calls** — 🟢
- `next.config.ts` sets no `serverActions.allowedOrigins`, so Next.js's built-in check applies: the request's Origin must match its Host / X-Forwarded-Host.
- The session cookie is `httpOnly`, `SameSite=Lax` and host-only (`server/auth/authen-client.ts:11-16`).
- A forged call with a valid session can only set or delete a key for one of the two allow-listed providers, with a validated format. That doesn't let it do anything the logged-in user couldn't already do.
- Precondition (deployment, not code): Cloudflare Tunnel must keep the original `Host` header. If it rewrites it, every action fails the origin check, which is safe but breaks the feature.

**Delete flow** — 🟢 security / 🟡 UX (minor)
- Deletion needs a confirmation step, the provider is allow-listed, and the action returns only a boolean.
- Minor UX issue: when `deleted: false` (no key was stored, e.g. a double submit or stale page), `Result` still shows "Đã xóa khóa …" (`ai-keys-card.tsx:204-208`). This is not a security problem but the message is misleading. Follow-up only (R7).

**r3-guard allowlist** — 🟢 Line 122 allows `apps/web/server/ai-keys.ts` to contain `ai_key_set`/`ai_key_delete`, but that file doesn't contain them; only the repo does. The allowlist is wider than it needs to be. It does no harm, but it could be tightened so a direct rpc call added there later gets caught.

### Recommendations
1. Optional: move the `FormMessage` type out of `server/` (R3 / client-boundary hygiene).
2. Optional: remove `apps/web/server/ai-keys.ts` (and its test) from the write-wrapper allowlist in `r3-guard.test.ts:118-127`, so calls stay limited to the repo layer.
3. Follow-up only: show a neutral message when `deleted === false`.

### Risks
- What gets shown is decided by ADR 0009: `last4` and the save date are visible on the page. That is acceptable.
- Origin-based CSRF protection depends on the Cloudflare Tunnel passing the `Host` header through unchanged.

### Open questions
- None blocking.
