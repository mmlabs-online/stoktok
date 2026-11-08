## STK-060 consult — software-architect

### Findings
1. **The fail-closed chain stays in place without the allowlist.** `authenticate()` (`apps/web/server/auth/require-user.ts`) maps a config error, a `getClaims()` error, missing data and any exception to `unauthenticated`. `checkClaims` (`claims.ts`) checks `exp`, `iss`, `aud` and `role === 'authenticated'` and requires a non-empty `sub`. Only the last line (`allowlist.has`) needs to go. `loadAuthConfig` still throws on a bad URL or anon key, so the app still fails closed on config.
2. **`forbidden` has nothing left to do.** The allowlist is its only source. After removal it can't be reached, so remove it: the `ClaimsResult` variant, the `forbidden()` branch in `requireUser`, the `forbidden` import, `apps/web/app/forbidden.tsx`, and `experimental: { authInterrupts: true }` in `apps/web/next.config.ts`. One exception: if you add the `is_anonymous` check from Rec 2, decide whether that case gets a 403 or goes to `/login` (see Open question 1).
3. **Removing the allowlist drops a hidden defence: it was the only thing rejecting anonymous Supabase users.** Anonymous sign-ins issue JWTs with `role: 'authenticated'`, `aud: 'authenticated'` and `is_anonymous: true`. Those pass every remaining check. The "Allow anonymous sign-ins" setting is separate from "Allow new users to sign up". The anon key isn't `NEXT_PUBLIC_*`, but treat it as public-grade. Nothing in `apps/web` reads `is_anonymous`, `aal` or `amr` today.
4. **"Email confirmed" can't be checked from the claims.** The JWT has no `email_confirmed_at`. Supabase already rejects `signInWithPassword` for unconfirmed users when "Confirm email" is on, so this belongs in the dashboard, not the code.
5. **`proxy.ts` only checks that `getClaims()` succeeds, not `checkClaims`.** That was already true. `requireUser()` stays the real gate (R6). Only the comment on line 13 ("allowlist is checked by requireUser()") needs updating.
6. **`userId` from `requireUser()` isn't used for data scoping anywhere outside the auth module.** A second account would see and change the same data, which is the risk Ming accepted.
7. **There are more allowlist references than the acceptance criteria list.**
   - Tests and fixtures: `proxy.test.ts:31`, `app/login/actions.test.ts:30`, `get-claims.test.ts:9`, `require-user.test.ts`.
   - `.claude/agents/reviewer.md:23` and `implementer.md:24` still say "auth + allowlist" and "R6 suspended", which is stale twice over.
   - Docs: `docs/figma-make-prompts.md:222`, `docs/spec-v1.md:252` (risk table: "v1 allowlist"), `docs/deploy.md:34,57,59,61,115`.
   - The `.env.example:8-9` comment and key.

### Recommendations
1. **Shrink the signature** (acceptance criterion 2): `checkClaims(claims, { issuer }, nowSec)` returning `{ok, userId} | {unauthenticated}`. Remove `allowlist` from `AuthConfig`. Keep the order expiry → issuer → aud/role → sub.
2. **Add `if (c.is_anonymous === true) return unauthenticated`** (criterion 2, R6 defence in depth). It's one line, costs nothing, and covers a dashboard toggle that's easy to miss. Test it. Don't require the claim to be present: older tokens may not carry it, so missing means not anonymous.
3. **Keep `aud` and `role` both.** Optionally also require `typeof c.session_id === 'string'`, so non-session JWTs signed with the project key don't count as a login. Don't add `aal`/`amr`/email checks: they're dashboard settings, not app logic.
4. **Tests** (criterion 3): ok for an arbitrary random UUID `sub`; still rejected for expired, `exp == now`, wrong `iss`, wrong `aud`, `role: anon`, `role: service_role`, empty `sub`, and `is_anonymous: true`. `config.test`: the app starts with `ALLOWLIST_USER_IDS` unset, and also with it set to junk (proves it's ignored). `require-user.test`: no `forbidden` mock left.
5. **`docs/deploy.md`** (criterion 5): list the access-control setup as required dashboard steps, not hardening: sign-ups off, **anonymous sign-ins off**, Confirm email on, no OAuth/SSO providers enabled, and a check that the Users list holds only Ming. Re-check after any Supabase project change.
6. **Update the agent prompts** (`reviewer.md`, `implementer.md`) to the new R6 wording. These are R7-adjacent, so get Ming's OK; otherwise log them as follow-ups.

### Risks
1. **The deploy order can lock Ming out silently.**
   - The workflow lives in the shared deployment repo. Its push trigger only covers `apps/stoktok/**`, but every later release or `workflow_dispatch` rewrites the env file.
   - If the new workflow (no `ALLOWLIST_USER_IDS` line) runs while the **old** image is still pinned, the old `loadAuthConfig` throws on every request and every login. `/healthz` doesn't load auth config, so the deploy reports **healthy** and doesn't roll back, while nobody can log in.
   - The other way round is safe: the new image with the old workflow just ignores the extra variable.
   - **Required order:** (a) merge the app change and release the new image while the old workflow still writes the variable; (b) merge the workflow change to the deploy repo; (c) only then delete `STOKTOK_ALLOWLIST_USER_IDS` from the `stoktok` environment. Write this order into `docs/deploy.md` and `work/ming-todo.md`.
   - A rollback to a pre-STK-060 image after step (b) hits the same lockout. Note that in the docs.
2. **The deploy is now the only access control.** Any account in the stoktok Auth project gets full access, and nothing in the app notices a stray user. This is accepted by Ming. Cheap mitigation: log `sub` at login, or keep a debt item for an "unexpected user" alert.
3. **`deploy-stoktok.yml` sits in the shared deploy repo.** Under CLAUDE.md §5 it is likely `pr-only`, and deploy config may be High tier. The ticket can only change the copy in `deploy/deployment-repo/`; Ming merges the real one.

### Open questions (for Ming; each has a default)
1. **Anonymous tokens: what should the user see?** Default: treat `is_anonymous` as `unauthenticated` and redirect to `/login`. That lets `forbidden.tsx` and `authInterrupts` go.
2. **Should the `session_id` presence check be added?** Default: yes. It's low cost and closes off non-session JWTs.
3. **Should the agent prompt updates go in this diff?** Default: yes, they're docs only and otherwise go stale.
