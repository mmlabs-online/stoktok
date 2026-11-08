Status: READY

# Plan — STK-060: Remove the allowlist check; any verified Supabase Auth user can sign in

## Spec summary
This ticket changes these lines of `docs/spec-v1.md`. Ming decided this on 2026-11-07 (ticket Notes: "không cần, cứ đúng user password là đc").
- §1.2: "**v1: Ming only.** Login via Authen (shared mmlabs SSO), restricted by an allowlist."
- §4.1 `web` row: "Next.js UI and API routes; reads/writes app DB; verifies Authen JWT + allowlist"
- §4.2: "Login through Authen; `web` validates the shared JWT." / "Allowlist check (Ming's user ID) on every request — v1 rejects all other authenticated mmlabs users."
- §9 Risks row: "App later opened to other users | Regulatory exposure | v1 allowlist; …" (stale after this change; consult finding 7).

The new rule, from the ticket Goal: "any user of the stoktok Supabase project's Auth with a valid session (correct email + password, JWT verified via `getClaims()`) can use the app. Single-user access is kept by disabling public sign-ups in the Supabase dashboard instead of an app-level allowlist."

`CLAUDE.md` R6 currently reads: "Every server route / server action verifies the Authen JWT and the allowlist." The ticket changes it (criterion 6).

## Acceptance criteria → verification
| # | Criterion (ticket) | How the reviewer verifies it |
|---|---|---|
| 1 | `loadAuthConfig()` no longer reads or requires `ALLOWLIST_USER_IDS`; the app starts with it unset | `config.test.ts › 'loads with ALLOWLIST_USER_IDS unset or set to junk (ignored)'`. `AuthConfig` has no `allowlist` field (typecheck). `config.ts` has no `ALLOWLIST` string |
| 2 | Claims check and `requireUser()` still check issuer, aud/role and expiry and fail closed. A valid session for any user ID returns `ok`. `forbidden` is removed | `claims.test.ts` cases (see Tests). `ClaimsResult` has no `forbidden` variant. `require-user.ts` does not import `forbidden`. `apps/web/app/forbidden.tsx` is deleted. `authInterrupts` is gone from `next.config.ts`. `pnpm build` passes |
| 3 | Tests updated (allowlist tests removed or replaced, arbitrary `sub` accepted, bad tokens rejected). `pnpm typecheck`, `pnpm lint`, `pnpm test` green | Run all three. Read the test list below |
| 4 | `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` no longer requires, validates or writes `STOKTOK_ALLOWLIST_USER_IDS` / `ALLOWLIST_USER_IDS` | Grep the file for `ALLOWLIST` (0 hits). `pnpm check:deploy-env` prints `OK` (it checks that the workflow printf keys equal the doc's `required now` rows and `.env.example`) |
| 5 | `.env.example`, `docs/deploy.md` and `work/ming-todo.md` no longer mention the allowlist. Disabling sign-ups is the access control, not optional hardening | Grep `-i allowlist` in those three files (0 hits). `deploy.md` has a required access-control checklist and the safe deploy order (Approach step 6). `ming-todo.md` has the same order |
| 6 | `docs/spec-v1.md` §1.2, §4.1, §4.2 and `CLAUDE.md` (intro, Auth row, R6 and its note) describe the new rule | Read the edited lines. They say: verified Authen JWT on every server route and action (`requireUser()`), and a single user enforced by disabled sign-ups |
| 7 | No reference to `ALLOWLIST_USER_IDS` outside `work/tickets/**` | `rg -n "ALLOWLIST_USER_IDS" --glob '!work/tickets/**'` returns nothing. Also `rg -in "allowlist" --glob '!work/tickets/**' --glob '!work/backlog.md' --glob '!work/solo-log.md'` returns only `apps/web/test/no-hardcoded-rules.test.ts` (an unrelated `ALLOWLIST` constant) |

## Files to create / modify
| File | Change | Required because |
|---|---|---|
| `apps/web/server/auth/config.ts` | Remove `allowlist` from `AuthConfig`, the `ALLOWLIST_USER_IDS` parsing and the `UUID` regex. Keep the URL and anon-key checks that throw | AC1 |
| `apps/web/server/auth/claims.ts` | `ClaimsResult = ok \| unauthenticated`. `cfg: { issuer: string }`. Order: object → exp → iss → aud/role → `is_anonymous === true` rejected → `session_id` must be a non-empty string → `sub` non-empty string → `ok` with lowercased `sub`. Update the doc comment | AC2. Consult Rec 1–3 |
| `apps/web/server/auth/require-user.ts` | Drop the `forbidden` import and branch. Update the comments ("Redirects; never returns otherwise") | AC2 |
| `apps/web/app/forbidden.tsx` | **Delete** | AC2. Nothing reaches it any more (consult finding 2) |
| `apps/web/next.config.ts` | Remove `experimental: { authInterrupts: true }`. It was only there for `forbidden()` | AC2 |
| `apps/web/proxy.ts` | Comment on line 13 only: "Full claims check is done by requireUser() in each entry point." | AC7 wording. Consult finding 5 |
| `apps/web/server/auth/claims.test.ts` | Rewrite to the new signature. Add the new cases, remove the allowlist and `forbidden` cases | AC3 |
| `apps/web/server/auth/config.test.ts` | Remove the allowlist tests and drop `ALLOWLIST_USER_IDS` from `base()`. Add the unset/junk test | AC1, AC3 |
| `apps/web/server/auth/require-user.test.ts` | Remove the `forbidden` mock and test and the `ALLOWLIST_USER_IDS` stub. Add `session_id` to `claims()`. The "config missing" test uses `AUTHEN_SUPABASE_URL=''`. Add the arbitrary-`sub` and anonymous-redirect tests | AC3 |
| `apps/web/server/auth/get-claims.test.ts` | `cfg = { issuer: ISS }`. Add `session_id` to the signed payload so the round trip still returns `ok` | AC3 (it calls `checkClaims`) |
| `apps/web/proxy.test.ts` | Remove the `ALLOWLIST_USER_IDS` stub (line 31) | AC7 |
| `apps/web/app/login/actions.test.ts` | Remove the `ALLOWLIST_USER_IDS` stub (line 30) | AC7 |
| `.env.example` | Remove lines 8–9 (allowlist comment and key) | AC5. `check-deploy-env.sh` needs it to match the doc table |
| `deploy/deployment-repo/.github/workflows/deploy-stoktok.yml` | Header comment (lines 15–19): remove the allowlist secret and name. `secrets` step: remove the env mapping, the missing check, the UUID regex block, and `ALLOWLIST_USER_IDS=%s` with its argument in the printf | AC4 |
| `docs/deploy.md` | Line 34: two auth secrets, not three. Rewrite "Restore auth" step 1 as a **required** access-control checklist (Approach step 5). Step 2: two secrets. Add the "Remove the allowlist (STK-060) — order" section (Approach step 6). Remove the `ALLOWLIST_USER_IDS` row from the env table | AC5. Consult Rec 5, Risk 1 |
| `work/ming-todo.md` | Login section: drop `STOKTOK_ALLOWLIST_USER_IDS` and "copy its UUID". Add the ordered STK-060 steps. In the "Edit docs/spec-v1.md …" item, remove the auth part only (now done); keep the intraday part | AC5 |
| `docs/spec-v1.md` | §1.2, §4.1 `web` row, §4.2 first two bullets, §9 risk row "v1 allowlist" → "v1 single user (public sign-ups disabled)". Nothing else | AC6. Consult finding 7 |
| `CLAUDE.md` (project) | Line 4 intro, line 20 Auth row, R6 row (line 42) and the R6 note block | AC6 |
| `docs/figma-make-prompts.md` | Line 222: "behind auth + allowlist" → "behind auth (`requireUser()`)" | Consult finding 7. Docs only |
| `.claude/agents/reviewer.md` | Line 23: the R6 clause becomes "server entry points without `requireUser()` (R6)". Drop "currently suspended … while suspended" | Consult Rec 6. Default 3 below |
| `.claude/agents/implementer.md` | Line 24: the R6 clause becomes "`requireUser()` on every server entry point (R6)". Drop the "suspended" text | Consult Rec 6. Default 3 below |

No `packages/core` change: this is auth, not domain logic (R1 is not involved).

## Tests to write
| Test (file › name) | Covers |
|---|---|
| `claims.test.ts › ok for valid claims of an arbitrary sub` (random UUID, e.g. `crypto.randomUUID()`, plus a second fixed UUID) | AC2: no allowlist |
| `claims.test.ts › sub is returned lowercased` (replaces the case-insensitive allowlist test) | Existing behaviour kept |
| `claims.test.ts › unauthenticated when exp is in the past or equals now` (keep) | Expiry |
| `claims.test.ts › unauthenticated when exp is missing or not a number` (keep) | Expiry |
| `claims.test.ts › unauthenticated when iss differs` (keep) | Issuer |
| `claims.test.ts › unauthenticated when aud lacks "authenticated"` (keep, string and array forms) | Audience |
| `claims.test.ts › unauthenticated when role is anon or service_role` (keep) | Role |
| `claims.test.ts › unauthenticated when sub is missing, empty or not a string` (add `''`) | Sub |
| `claims.test.ts › unauthenticated when is_anonymous is true; ok when it is false or absent` | Consult Rec 2, Default 1 |
| `claims.test.ts › unauthenticated when session_id is missing, empty or not a string` | Consult Rec 3, Default 2 |
| `claims.test.ts › unauthenticated for null/undefined/non-object claims` (keep) | Fail closed |
| `claims.test.ts › never returns a kind other than ok/unauthenticated` (optional; may be covered by typecheck) | AC2 |
| `config.test.ts › loads with ALLOWLIST_USER_IDS unset or set to junk (ignored)`: result is `{ supabaseUrl, anonKey, issuer }`, with no `allowlist` key | AC1 |
| `config.test.ts` URL, anon key and issuer tests (keep) | Fail closed on config |
| `require-user.test.ts › returns userId for an arbitrary sub` | AC2 |
| `require-user.test.ts › redirects to /login for an anonymous session, and the caller's next line never runs` (replaces the forbidden test; same `getDb` pattern) | AC2. Default 1 |
| `require-user.test.ts › redirects to /login when auth config is missing` (now via `AUTHEN_SUPABASE_URL=''`) | Fail closed |
| `require-user.test.ts` existing redirect tests (keep) | Fail closed |
| `get-claims.test.ts › getClaims(jwt) accepts an ES256 token …` (payload gets `session_id`) | Real supabase-js round trip still ends `ok` |

## Approach
1. **Auth code** (R6). Change `config.ts`, `claims.ts` and `require-user.ts` as in the file table. `authenticate()` keeps its try/catch paths, which all return `unauthenticated`, so it still fails closed. `requireUser()` is now: `ok` returns, anything else calls `redirect(loginPath(...))`. The login page (`app/login/page.tsx:10`) redirects away only on `ok`, so an anonymous or claim-rejected session lands on the login form and does not loop.
2. **Remove the forbidden path.** Delete `app/forbidden.tsx` and the `authInterrupts` flag. Grep that `LogoutButton` is still used elsewhere; do not touch it.
3. **Tests**: as listed. Remove every `ALLOWLIST_USER_IDS` stub.
4. **Env and workflow draft.** Edit `.env.example`, the `deploy.md` env table and the `deploy-stoktok.yml` secrets step together, then run `pnpm check:deploy-env` (it diffs these three). Do not change any other workflow step. Keep the URL and anon-key validation.
5. **`docs/deploy.md` "Restore auth" step 1** becomes the access control, with all items **required**: Email provider on; "Allow new users to sign up" **off**; **anonymous sign-ins off**; every other provider off (phone, OAuth, SSO/SAML); "Confirm email" on; minimum password 12+ and leaked-password protection if the plan offers it; Site URL and Redirect URLs `https://<APP_HOSTNAME>` only; create Ming's user (auto-confirm); then check that Authentication → Users lists **only** Ming. Re-check after any change to the Supabase project. Say plainly that any user in this project's Auth gets full access (Ming accepted this, 2026-11-07), and that Cloudflare Access stays in front.
6. **Safe deploy order**, in `docs/deploy.md` (new section "Remove the allowlist (STK-060) — order") and `work/ming-todo.md`:
   - (a) Merge STK-060 and release the new image **while the deployment repo still runs the old workflow** (it still writes `ALLOWLIST_USER_IDS`, and the new image ignores it).
   - (b) Then merge the deployment-repo PR with the new `deploy-stoktok.yml`.
   - (c) Only then delete `STOKTOK_ALLOWLIST_USER_IDS` from the `stoktok` environment.
   - Why: an STK-004…STK-059 image under the new workflow throws in `loadAuthConfig` on every request. `/healthz` stays 200, so the deploy reports healthy and does not roll back, but nobody can log in.
   - **Rollback warning**: after (b), do not roll back to a pre-STK-060 image that has auth (STK-004+). If you must, re-add the secret and the old workflow first.
   - If no auth image (STK-004+) has been released yet, skip the allowlist secret entirely and ship STK-060 together with the auth setup. Pre-STK-004 images read no auth env.
7. **Spec and CLAUDE.md wording.**
   - §1.2: "Login via Authen (Supabase Auth of stoktok's own Supabase project, STK-048). Single user: public sign-ups are disabled in that project; any account in it has full access (Ming, 2026-11-07, STK-060)."
   - §4.1: "verifies the Authen JWT".
   - §4.2: "`web` verifies the session JWT server-side (`getClaims()` + issuer/aud/role/expiry, non-anonymous session) on every request; single user enforced by disabled sign-ups, not an app-level allowlist."
   - Leave the §4.2 open-question bullet and the rest of the spec unchanged. The spec has no Decisions Log entry about the allowlist; check before editing and stop if one exists.
   - CLAUDE.md R6: "**Every server route / server action verifies the Authen JWT** (`requireUser()`). Single-user access is enforced by disabled public sign-ups in the stoktok Supabase project, not an allowlist (Ming, 2026-11-07, STK-060)." Update the note block and the Auth row to match.
8. **Agent prompts**: the one-clause edits in the file table.
9. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and `pnpm check:deploy-env`, then the AC7 greps.

Rules: R6 is met: `requireUser()` stays on every entry point and still fails closed, with two extra claim checks. R3 is unaffected. R7: every file is listed above. R8: the auth checks have tests (not core logic, but tested anyway). R10 is not affected.

## Specialist input used
`consult-software-architect.md`:
- Finding 1 and Rec 1 (smaller signature, same check order): **adopted**.
- Finding 2 (remove `forbidden`, `forbidden.tsx`, `authInterrupts`): **adopted**, because anonymous sessions redirect (Default 1).
- Finding 3 and Rec 2 (reject `is_anonymous === true`; a missing claim counts as not anonymous): **adopted**.
- Finding 4 (email confirmation is a dashboard setting): **adopted** as a deploy.md checklist item, not code.
- Finding 5 (`proxy.ts` comment only): **adopted**.
- Finding 7 (extra references): **adopted**. All of them are in the file list.
- Rec 3 (keep aud and role; add `session_id` presence; no aal/amr/email checks): **adopted**.
- Rec 4 (test list): **adopted**.
- Rec 5 (required dashboard checklist): **adopted**.
- Rec 6 (agent prompts): **adopted**, as Default 3.
- Risk 1 (deploy order, rollback lockout): **adopted** (Approach step 6).
- Risk 2 ("unexpected user" logging or alert): **not in this diff**. The implementer records it as a follow-up and the orchestrator opens a `debt` issue. It is new behaviour the ticket did not ask for.
- Risk 3 (the deploy repo is `pr-only` and probably High tier): **noted**. Only the draft copy under `deploy/deployment-repo/` changes, and Ming merges the real one.

## Assumptions
**Defaults for Ming to confirm** (non-blocking; the plan proceeds with them):
1. An anonymous Supabase session (`is_anonymous: true`) is `unauthenticated` and redirects to `/login`. No 403 page, so `forbidden.tsx` and `authInterrupts` are removed.
2. Add the `session_id` presence check: a JWT without a non-empty string `session_id` is `unauthenticated`. Supabase access tokens from password sign-in carry `session_id`. If a real token ever lacks it, Ming gets locked out and it shows at once at login. The fix is a one-line revert.
3. Update `.claude/agents/reviewer.md` and `implementer.md` in this diff, R6 clause only. If the permission system refuses edits under `.claude/` or to `CLAUDE.md`, the implementer stops on those files, records them under Out-of-plan/Follow-ups, and does the rest.

Other assumptions:
- Changing auth wording in spec §1.2/§4.1/§4.2/§9 and `CLAUDE.md` is authorised by the ticket (Ming created it with these criteria).
- The stale line `docs/deploy.md:15` ("No auth code is in the app (R6 suspended)…") and the §4.2 open question about JWT trust are out of scope. Record them as follow-ups and do not edit them.
- The PR is likely High tier (auth plus deploy config draft). CI decides the tier.
- `apps/web/test/no-hardcoded-rules.test.ts`'s `ALLOWLIST` constant is unrelated and stays.
- The diff is small (about 150–250 lines), so it fits in one cycle.

## Blocking questions
None.

## Split proposal
None.
